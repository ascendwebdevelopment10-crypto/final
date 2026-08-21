import { logEmail, isSuppressed, markEmailed, wasEmailed } from '../lib/store.js';
import { sendEmail } from '../lib/mailer.js';
import { outreachTokenFor, tokenFor } from '../lib/sign.js';
import { kv } from '@vercel/kv';
import { fetchOsmLeadPool, OUTREACH_OSM_TAGS } from '../lib/leads.js';
import { isLikelyRealEmail } from '../lib/email-validate.js';
import { ensureOutreachWebhook } from '../lib/outreach-webhook.js';
import { emailMatchesBusinessWebsite, isQualifiedOutreachEmail, qualifyOutreachContact, replyAngle, websiteOpportunity } from '../lib/outreach-targeting.js';

export const config = { maxDuration: 300 };

// EMAIL ENGINE. Uses the FREE OpenStreetMap lead source (never paid Outscraper).
const OUTREACH_FROM_EMAIL = process.env.OUTREACH_FROM_EMAIL || 'ty@nitrooutreach.com';
const OUTREACH_FROM = `Nitro Outreach <${OUTREACH_FROM_EMAIL}>`;
const OUTREACH_REPLY_TO = process.env.OUTREACH_REPLY_TO || process.env.REPLY_TO || OUTREACH_FROM_EMAIL;
const PHYSICAL_ADDRESS = '791 S 140 E, Farmington, UT 84025';
const CRON_SECRET = process.env.CRON_SECRET;
const EMAIL_CAP = 10;   // 10/run x 9 runs/day = 90/day, stays under Resend free cap (100/day)
const DAILY_EMAIL_CAP = 90;
const PROVIDER_DAILY_CAP = 100;
const POOL_COUNT = 8;
const POOL_SIZE = 60;
const DISCOVERY_WAVE_SIZE = 16;
const MAX_WEBSITES_CHECKED = 96;

const BCC_PREVIEW_EMAIL = 'no-reply@nitrooutreach.app';
const BCC_PREVIEW_LIMIT = 0;  // BCC preview off to conserve Resend quota

const SERVICES = ['website', 'ads', 'app'];
function pickService() { return SERVICES[Math.floor(Math.random() * SERVICES.length)]; }

function mountainDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function mountainHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23',
  }).format(new Date()));
}

async function reserveDailySlot() {
  const key = `outreach:email:daily-reserved:${mountainDate()}`;
  const used = Number(await kv.incr(key));
  if (used === 1) await kv.expire(key, 172800);
  if (used > DAILY_EMAIL_CAP) {
    await kv.decr(key);
    return null;
  }
  return key;
}

async function reserveProviderSlot() {
  const date = mountainDate();
  const key = `outreach:email:all-daily-reserved:${date}`;
  const baseline = Number(await kv.get(`stats:daily:${date}`)) || 0;
  await kv.set(key, String(baseline), { nx: true, ex: 172800 });
  const used = Number(await kv.incr(key));
  if (used > PROVIDER_DAILY_CAP) {
    await kv.decr(key);
    return null;
  }
  return key;
}

async function reserveRecipient(email) {
  return await kv.set(`outreach:email:reservation:${email.toLowerCase()}`, '1', { nx: true, ex: 900 });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function normalizeWebsite(raw) {
  try {
    const value = String(raw || '').trim();
    if (!value) return '';
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function decodeCloudflareEmail(value) {
  try {
    const key = parseInt(value.slice(0, 2), 16);
    let output = '';
    for (let i = 2; i < value.length; i += 2) output += String.fromCharCode(parseInt(value.slice(i, i + 2), 16) ^ key);
    return output;
  } catch { return ''; }
}

function decodeEmailText(html) {
  return String(html || '')
    .replace(/&#(?:x40|64);/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/\s(?:\[at\]|\(at\))\s/gi, '@')
    .replace(/\s(?:\[dot\]|\(dot\))\s/gi, '.');
}

function extractEmails(html, pageUrl) {
  const decoded = decodeEmailText(html);
  const found = new Set(decoded.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,24}/g) || []);
  for (const match of decoded.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const email = decodeCloudflareEmail(match[1]);
    if (email) found.add(email);
  }
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
  const junk = ['sentry.io','wixpress.com','schema.org','google.com','facebook.com','twitter.com','instagram.com','youtube.com'];
  const candidates = [...found]
    .map(email => email.toLowerCase().replace(/^mailto:/, '').trim())
    .filter(isLikelyRealEmail)
    .filter(email => emailMatchesBusinessWebsite(email, pageUrl) && isQualifiedOutreachEmail(email))
    .filter(email => !junk.some(domain => email.endsWith('@' + domain)));
  const roleOrder = ['info','contact','hello','sales','office','admin','team','booking','appointments','support'];
  return candidates.sort((a, b) => {
    const [aLocal, aDomain] = a.split('@');
    const [bLocal, bDomain] = b.split('@');
    const score = (local, domain) => {
      const roleIndex = roleOrder.indexOf(local);
      return (domain === host || host.endsWith('.' + domain) ? 30 : 0) + (roleIndex === -1 ? 0 : 12 - roleIndex);
    };
    return score(bLocal, bDomain) - score(aLocal, aDomain);
  });
}

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'NitroOutreach/1.0 (+https://nitrooutreach.com)' },
    });
    clearTimeout(timer);
    if (!res.ok || !String(res.headers.get('content-type') || '').includes('text/html')) return null;
    return { html: (await res.text()).slice(0, 1500000), url: res.url || url };
  } catch { return null; }
}

function contactLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    if (!/(contact|about|team|staff|location|connect|get-in-touch)/i.test(match[1])) continue;
    try {
      const url = new URL(match[1], baseUrl);
      if (url.origin !== new URL(baseUrl).origin || !['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      if (!links.includes(url.href)) links.push(url.href);
    } catch {}
    if (links.length >= 3) break;
  }
  return links;
}

async function discoverEmail(rawUrl) {
  const website = normalizeWebsite(rawUrl);
  if (!website) return null;
  const home = await fetchHtml(website);
  if (!home) return null;
  const homeEmails = extractEmails(home.html, home.url);
  if (homeEmails.length) return homeEmails[0];

  const origin = new URL(home.url).origin;
  const discovered = contactLinks(home.html, home.url);
  const fallback = ['/contact', '/contact-us', '/about'].map(path => origin + path);
  const pages = [...new Set([...discovered, ...fallback])].slice(0, 3);
  const results = await Promise.all(pages.map(fetchHtml));
  for (const page of results.filter(Boolean)) {
    const emails = extractEmails(page.html, page.url);
    if (emails.length) return emails[0];
  }
  return null;
}

function normalizeContact(place) {
  const contact = {
    first_name: (place.name || '').split(' ')[0] || 'there',
    organization_name: place.name || '',
    email: place.email || null,     // use the email OSM already provides, when present
    phone: place.phone || null,
    website_url: place.website || '',
    industry: place.type || place.subtypes || '',
    businessLocation: place.full_address || '',
    isChain: Boolean(place.isChain),
  };
  contact.targetSegment = qualifyOutreachContact(contact);
  return contact;
}

async function generateEmail(contact) {
  const company = contact.organization_name || 'your business';
  const service = contact.targetSegment === 'Solo / small agency' ? 'agency' : pickService();
  const angle = contact.marketingOpportunity || replyAngle(contact.industry);

  const subjects = [
    'A simpler marketing setup for ' + company,
    'One place for ' + company + ' marketing',
    'Could Nitro help ' + company + '?',
    company + ' marketing, in one place'
  ];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const opener = 'Hi ' + company + ' team,';
  const bodies = [
    opener + '\n\nNitro is an all-in-one marketing workspace for small businesses. It lets you build a website, create and schedule social posts, run tracked outreach, and see visits and engagement in one place.\n\nFor ' + company + ', that can make it easier to ' + angle + ' without paying for or switching between separate tools. You can start free with no card and try it on a real part of your marketing.\n\nnitrooutreach.com',
    opener + '\n\nNitro brings website building, social content, scheduling, outreach, and analytics into one workspace built for small businesses.\n\nIt could help ' + company + ' ' + angle + ', while keeping the work and the results together instead of spread across different apps. The free account does not require a card.\n\nnitrooutreach.com',
    opener + '\n\nNitro helps small businesses create a website, make and schedule content, send tracked outreach, and understand which activity brings people back.\n\nFor ' + company + ', that means one simpler system to ' + angle + '. You can see how it works and start free here:\n\nnitrooutreach.com'
  ];
  const body = bodies[Math.floor(Math.random() * bodies.length)];

  return { subject, body, service };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

  // Send only from 8 a.m. through 4 p.m. Mountain Time. The extra UTC cron in
  // vercel.json keeps this window correct across daylight-saving changes.
  const mtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
  if (mtDay === 'Sun') { res.status(200).json({ skipped: 'sunday', timestamp: new Date().toISOString() }); return; }
  const mtHour = mountainHour();
  if (mtHour < 8 || mtHour > 16) { res.status(200).json({ skipped: 'outside-send-window', mountainHour: mtHour, timestamp: new Date().toISOString() }); return; }

  let emailsSent = 0;
  const errors = [];

  try {
    const webhook = await ensureOutreachWebhook();
    if (webhook.status !== 'active') errors.push({ type: 'webhook', error: webhook.status });
    const batches = await Promise.allSettled(
      Array.from({ length: POOL_COUNT }, (_, index) => fetchOsmLeadPool(OUTREACH_OSM_TAGS, POOL_SIZE, index))
    );
    const rawLeads = batches.flatMap(b => b.status === 'fulfilled' ? b.value : []);
    const leads = [];
    const leadKeys = new Set();
    for (const place of rawLeads) {
      const contact = normalizeContact(place);
      if (!contact.targetSegment) continue;
      const key = String(contact.email || normalizeWebsite(contact.website_url) || (contact.organization_name + '|' + place.full_address)).toLowerCase();
      if (!key || leadKeys.has(key)) continue;
      leadKeys.add(key);
      leads.push(contact);
    }

    const emailableLeads = [];
    const seen = new Set();
    async function consider(contact) {
      if (!contact.email || !isLikelyRealEmail(contact.email) || !isQualifiedOutreachEmail(contact.email) || !emailMatchesBusinessWebsite(contact.email, contact.website_url)) return;
      const key = contact.email.toLowerCase();
      if (seen.has(key) || await wasEmailed(key) || await isSuppressed(key)) return;
      seen.add(key);
      emailableLeads.push(contact);
    }

    for (const contact of leads.filter(c => c.email)) {
      if (emailableLeads.length >= EMAIL_CAP) break;
      await consider(contact);
    }

    const websites = leads.filter(c => !c.email && normalizeWebsite(c.website_url));
    let websitesChecked = 0;
    for (let offset = 0; offset < websites.length && emailableLeads.length < EMAIL_CAP && websitesChecked < MAX_WEBSITES_CHECKED; offset += DISCOVERY_WAVE_SIZE) {
      const remainingChecks = MAX_WEBSITES_CHECKED - websitesChecked;
      const wave = websites.slice(offset, offset + Math.min(DISCOVERY_WAVE_SIZE, remainingChecks));
      const found = await Promise.all(wave.map(async contact => ({ contact, email: await discoverEmail(contact.website_url) })));
      websitesChecked += wave.length;
      for (const { contact, email } of found) {
        if (emailableLeads.length >= EMAIL_CAP) break;
        contact.email = email;
        await consider(contact);
      }
    }

    console.log('[email-cron]', JSON.stringify({
      fetched: rawLeads.length,
      uniqueBusinesses: leads.length,
      websitesChecked,
      maxWebsitesChecked: MAX_WEBSITES_CHECKED,
      eligibleEmails: emailableLeads.length,
      sourcePoolsRequested: POOL_COUNT,
      sourcePoolsSucceeded: batches.filter(b => b.status === 'fulfilled').length,
    }));

    const inspectedLeads = await Promise.all(emailableLeads.map(async contact => {
      const page = await fetchHtml(normalizeWebsite(contact.website_url));
      return { ...contact, marketingOpportunity: websiteOpportunity(page?.html, contact.industry) };
    }));
    const emailContents = await Promise.all(inspectedLeads.map(c => generateEmail(c).catch(e => ({ error: e.message }))));

    const sendResults = await Promise.all(inspectedLeads.map(async (contact, i) => {
      const content = emailContents[i];
      if (content.error) return { error: content.error };
      let dailyKey = null;
      let providerKey = null;
      let reservationKey = null;
      let delivered = false;
      try {
        if (await isSuppressed(contact.email) || await wasEmailed(contact.email)) return null;
        const reserved = await reserveRecipient(contact.email);
        if (!reserved) return null;
        reservationKey = `outreach:email:reservation:${contact.email.toLowerCase()}`;
        dailyKey = await reserveDailySlot();
        if (!dailyKey) { await kv.del(reservationKey); return { limited: true }; }
        providerKey = await reserveProviderSlot();
        if (!providerKey) { await kv.decr(dailyKey); await kv.del(reservationKey); return { limited: true }; }
        const { subject, body, service } = content;
        const trackingId = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        const unsubscribeUrl = 'https://nitrooutreach.com/unsubscribe?e=' + encodeURIComponent(contact.email) + '&t=' + encodeURIComponent(tokenFor(contact.email));
        const siteUrl = 'https://nitrooutreach.com/start?utm_source=outreach&utm_medium=email&utm_campaign=independent-business&oid=' + encodeURIComponent(trackingId) + '&ot=' + encodeURIComponent(outreachTokenFor(trackingId));
        // Keep the plain-text fallback and dashboard preview readable. The
        // unique attribution URL stays behind the short HTML CTA instead of
        // being exposed as a multi-line query string in the email body.
        const textBody = body;
        const emailHtml = escapeHtml(body)
          .replaceAll('nitrooutreach.com', '<a href="' + escapeHtml(siteUrl) + '" style="color:#111827;font-weight:700;text-decoration:underline">nitrooutreach.com</a>')
          .replace(/\n/g, '<br>');
        const openPixelUrl = 'https://nitrooutreach.com/api/track-open?id=' + encodeURIComponent(trackingId);
        const footerText = '\n\n--\nTy Smith, Owner\nNitro Outreach\n' + PHYSICAL_ADDRESS + '\nUnsubscribe: ' + unsubscribeUrl;
        const footerHtml = '<br><br>--<br>Ty Smith, Owner<br>Nitro Outreach<br>' + escapeHtml(PHYSICAL_ADDRESS) + '<br><a href="' + escapeHtml(unsubscribeUrl) + '">Unsubscribe</a>' +
          '<img src="' + escapeHtml(openPixelUrl) + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />';
        const sendOptions = {
          from: OUTREACH_FROM,
          to: contact.email,
          subject,
          text: textBody + footerText,
          html: emailHtml + footerHtml,
          reply_to: OUTREACH_REPLY_TO,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          idempotencyKey: 'nitro-cold-outreach-' + Buffer.from(contact.email.toLowerCase()).toString('base64url'),
        };
        if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
        const sendResult = await sendEmail(sendOptions);
        delivered = true;
        await markEmailed(contact.email);
        await logEmail({
          id: trackingId,
          to: contact.email,
          subject,
          body: textBody,
          contactName: contact.organization_name,
          timestamp: Date.now(),
          segment: 'needs_upgrade',
          service,
          industry: contact.industry,
          targetSegment: contact.targetSegment,
          businessLocation: contact.businessLocation,
          businessWebsite: contact.website_url,
          providerId: sendResult?.id || sendResult?.messageId || '',
          status: 'sent',
        });
        return 'ok';
      } catch (e) {
        if (dailyKey && !delivered) await kv.decr(dailyKey).catch(() => {});
        if (providerKey && !delivered) await kv.decr(providerKey).catch(() => {});
        if (reservationKey && !delivered) await kv.del(reservationKey).catch(() => {});
        return { error: e.message };
      }
    }));

    emailsSent = sendResults.filter(r => r === 'ok').length;
    sendResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
  } catch (e) {
    errors.push({ type: 'fatal', error: e.message });
  }

  console.log('[email-cron] result', JSON.stringify({ emailsSent, errors }));
  res.status(200).json({ emailsSent, emailCap: EMAIL_CAP, dailyEmailCap: DAILY_EMAIL_CAP, errors, timestamp: new Date().toISOString() });
}
