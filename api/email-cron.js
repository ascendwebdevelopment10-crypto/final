import { logEmail, isSuppressed, markEmailed, wasEmailed } from '../lib/store.js';
import { sendEmail } from '../lib/mailer.js';
import { tokenFor } from '../lib/sign.js';
import { kv } from '@vercel/kv';
import { fetchOsmLeads, OSM_TAGS } from '../lib/leads.js';

export const config = { maxDuration: 300 };

// EMAIL ENGINE. Uses the FREE OpenStreetMap lead source (never paid Outscraper).
const OUTREACH_FROM_EMAIL = process.env.OUTREACH_FROM_EMAIL || 'ty@nitrooutreach.com';
const OUTREACH_FROM = `Nitro Outreach <${OUTREACH_FROM_EMAIL}>`;
const OUTREACH_REPLY_TO = process.env.OUTREACH_REPLY_TO || process.env.REPLY_TO || OUTREACH_FROM_EMAIL;
const PHYSICAL_ADDRESS = '791 S 140 E, Farmington, UT 84025';
const CRON_SECRET = process.env.CRON_SECRET;
const EMAIL_CAP = 10;   // 10/run x 9 runs/day = 90/day, stays under Resend free cap (100/day)
const DAILY_EMAIL_CAP = 90;
const FETCH_LIMIT = 20;

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

async function reserveRecipient(email) {
  return await kv.set(`outreach:email:reservation:${email.toLowerCase()}`, '1', { nx: true, ex: 900 });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function isLikelyRealEmail(email) {
  if (!email || email.length > 100) return false;
  if (!/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(email)) return false;
  const badEnd = ['.png','.jpg','.jpeg','.svg','.gif','.webp','.avif','.ico','.css','.js','.woff'];
  if (badEnd.some(b => email.toLowerCase().endsWith(b))) return false;
  return true;
}

async function scrapeEmail(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const matches = [...new Set((html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []))];
    const junk = ['example.','sentry.','w3.org','schema.','wix','squarespace','shopify','google.','facebook.','twitter.','instagram.','youtube.','.png','.jpg','.jpeg','.svg','.gif','.webp','.css','.js'];
    const clean = matches.filter(e => !junk.some(j => e.toLowerCase().includes(j))).filter(isLikelyRealEmail);
    return clean.find(e => /^(info|contact|hello|sales|office|admin|support|team|booking)@/i.test(e)) || clean[0] || null;
  } catch { return null; }
}

function normalizeContact(place) {
  return {
    first_name: (place.name || '').split(' ')[0] || 'there',
    organization_name: place.name || '',
    email: place.email || null,     // use the email OSM already provides, when present
    phone: place.phone || null,
    website_url: place.website || '',
    industry: place.type || place.subtypes || ''
  };
}

async function generateEmail(contact) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your business';
  const service = pickService();

  const subjects = [
    'Quick idea for ' + company,
    'Marketing help for ' + company + '?',
    'A simpler way to run ' + company + "'s marketing",
    'Helping ' + company + ' get more customers',
    'One tool for all of ' + company + "'s marketing"
  ];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];

  const opener = ['Hi ' + firstName + ',', 'Hey ' + firstName + ',', 'Hi ' + firstName + ' -'][Math.floor(Math.random() * 3)];

  const bodies = [
    opener + '\n\nI run Nitro Outreach, an all-in-one marketing platform. One login builds your website, social posts, Reels, and ad campaigns - so ' + company + ' can replace a pile of separate tools and save time and money.\n\nIt is free to start, no credit card. If it sounds useful, take a look: https://nitrooutreach.com\n\nEither way, wishing ' + company + ' a great week.',
    opener + '\n\nMost small teams juggle five different tools to keep their marketing going. Nitro Outreach puts it all in one place - website, social, Reels, and ads - built with AI from a single login.\n\nThought it might save ' + company + ' some time. It is free to try, no card needed: https://nitrooutreach.com\n\nHappy to answer any questions - just reply to this email.',
    opener + '\n\nQuick one: I built Nitro Outreach to help businesses like ' + company + ' handle all their marketing in one spot - website, social posts, Reels, and ad campaigns - without hiring an agency or stitching apps together.\n\nFree to start, no credit card: https://nitrooutreach.com\n\nWorth a look if you have a couple of minutes.'
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
    const qi = Math.floor(Math.random() * OSM_TAGS.length);
    const batches = await Promise.allSettled([
      fetchOsmLeads(OSM_TAGS[qi], FETCH_LIMIT),
      fetchOsmLeads(OSM_TAGS[(qi + 1) % OSM_TAGS.length], FETCH_LIMIT),
      fetchOsmLeads(OSM_TAGS[(qi + 2) % OSM_TAGS.length], FETCH_LIMIT),
      fetchOsmLeads(OSM_TAGS[(qi + 3) % OSM_TAGS.length], FETCH_LIMIT)
    ]);
    const leads = batches.flatMap(b => b.status === 'fulfilled' ? b.value : []).map(normalizeContact);

    // Use the email OSM already gave us; only scrape a homepage when we have none.
    const scraped = await Promise.all(leads.map(c => (c.email ? Promise.resolve(c.email) : scrapeEmail(c.website_url))));
    leads.forEach((c, i) => { c.email = c.email || scraped[i] || null; });

    const emailCandidates = leads.filter(c => c.email && isLikelyRealEmail(c.email));
    console.log('[email-cron]', JSON.stringify({ fetched: leads.length, withEmail: emailCandidates.length }));

    const emailableLeads = [];
    const seen = new Set();
    for (const c of emailCandidates) {
      if (emailableLeads.length >= EMAIL_CAP) break;
      const key = c.email.toLowerCase();
      if (seen.has(key)) continue;
      if (await wasEmailed(key)) continue;   // never email the same business twice
      seen.add(key);
      emailableLeads.push(c);
    }

    const emailContents = await Promise.all(emailableLeads.map(c => generateEmail(c).catch(e => ({ error: e.message }))));

    const sendResults = await Promise.all(emailableLeads.map(async (contact, i) => {
      const content = emailContents[i];
      if (content.error) return { error: content.error };
      let dailyKey = null;
      let reservationKey = null;
      let delivered = false;
      try {
        if (await isSuppressed(contact.email) || await wasEmailed(contact.email)) return null;
        const reserved = await reserveRecipient(contact.email);
        if (!reserved) return null;
        reservationKey = `outreach:email:reservation:${contact.email.toLowerCase()}`;
        dailyKey = await reserveDailySlot();
        if (!dailyKey) { await kv.del(reservationKey); return { limited: true }; }
        const { subject, body, service } = content;
        const unsubscribeUrl = 'https://nitrooutreach.com/unsubscribe?e=' + encodeURIComponent(contact.email) + '&t=' + encodeURIComponent(tokenFor(contact.email));
        const footerText = '\n\n--\nTy Smith, Owner\nNitro Outreach\n' + PHYSICAL_ADDRESS + '\nUnsubscribe: ' + unsubscribeUrl;
        const footerHtml = '<br><br>--<br>Ty Smith, Owner<br>Nitro Outreach<br>' + escapeHtml(PHYSICAL_ADDRESS) + '<br><a href="' + escapeHtml(unsubscribeUrl) + '">Unsubscribe</a>';
        const sendOptions = {
          from: OUTREACH_FROM,
          to: contact.email,
          subject,
          text: body + footerText,
          html: escapeHtml(body).replace(/\n/g, '<br>') + footerHtml,
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
          to: contact.email,
          subject,
          body,
          contactName: contact.organization_name,
          timestamp: Date.now(),
          segment: 'needs_upgrade',
          service,
          providerId: sendResult?.id || sendResult?.messageId || '',
          status: 'sent',
        });
        return 'ok';
      } catch (e) {
        if (dailyKey && !delivered) await kv.decr(dailyKey).catch(() => {});
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
