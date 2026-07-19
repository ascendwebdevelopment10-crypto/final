import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { logEmail, isSuppressed } from '../lib/store.js';
import { kv } from '@vercel/kv';
import { fetchOsmLeads, OSM_TAGS } from '../lib/leads.js';

export const config = { maxDuration: 300 };

// EMAIL ENGINE. Uses the FREE OpenStreetMap lead source (never paid Outscraper).
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const EMAIL_CAP = 16;   // target 16 emails/run (matches dashboard schedule tab); daily total still bounded by Resend free plan (~100/day)   // up to 10 emails per run (until Resend's daily cap)
const FETCH_LIMIT = 30;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 0;  // BCC preview off to conserve Resend quota

const SERVICES = ['website', 'ads', 'app'];
function pickService() { return SERVICES[Math.floor(Math.random() * SERVICES.length)]; }

function cleanPlaceholders(text) {
  return text
    .replace(/\[your name\]/gi, 'Ty Smith')
    .replace(/\[name\]/gi, 'Ty Smith')
    .replace(/\(your name\)/gi, 'Ty Smith')
    .replace(/\[your company\]/gi, 'Ascend Web Development')
    .replace(/\[company name\]/gi, 'Ascend Web Development')
    .replace(/\[your (?:phone|number|email|website|link|url)[^\]]*\]/gi, '')
    .replace(/\[[^\]]{1,40}\]/g, '')
    .trim();
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
  const industry = contact.industry || 'your industry';
  const service = pickService();
  const serviceDesc = service === 'website'
    ? 'SEO-optimized websites that drive more Google traffic'
    : service === 'ads'
    ? 'Google and Meta ad campaigns that bring in real paying customers'
    : 'custom mobile apps with online booking, loyalty rewards, and push notifications';
  const prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + ' in the ' + industry + ' industry. We are Ascend Web Development. LEAD BY OFFERING A FREE, no-obligation audit of their website: say you took a quick look at their site and noticed a couple of things that are likely costing them calls/customers, and you will send the full audit over if they just reply. You can also mention we build ' + serviceDesc + '. Friendly, no fluff, no hard sell. Soft CTA: just reply and I will send it over. Subject line first as "Subject: ...". Sign off as: Ty Smith, Owner - Ascend Web Development. Do NOT use any placeholder text in brackets. Output only the subject line and body.';
  const msg = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 350, messages: [{ role: 'user', content: prompt }] });
  const text = cleanPlaceholders(msg.content[0].text);
  const lines = text.split('\n');
  const subjectLine = lines.find(l => l.startsWith('Subject:'));
  const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'A quick free audit of your website';
  const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
  return { subject, body, service };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

  // Take Sundays off (Mountain Time).
  const mtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
  if (mtDay === 'Sun') { res.status(200).json({ skipped: 'sunday', timestamp: new Date().toISOString() }); return; }

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
      if (await kv.sismember('emailed:set', key)) continue;   // never email the same business twice
      seen.add(key);
      emailableLeads.push(c);
    }

    const emailContents = await Promise.all(emailableLeads.map(c => generateEmail(c).catch(e => ({ error: e.message }))));

    const sendResults = await Promise.all(emailableLeads.map(async (contact, i) => {
      const content = emailContents[i];
      if (content.error) return { error: content.error };
      try {
        if (await isSuppressed(contact.email)) return null;
        const { subject, body, service } = content;
        const footer = '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=' + encodeURIComponent(contact.email) + '">Unsubscribe</a>';
        const sendOptions = { from: FROM_EMAIL, to: contact.email, subject, html: (body + footer).replace(/\n/g, '<br>'), reply_to: FROM_EMAIL };
        if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
        await resend.emails.send(sendOptions);
        await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: 'needs_upgrade', service });
        await kv.sadd('emailed:set', contact.email.toLowerCase());
        return 'ok';
      } catch (e) { return { error: e.message }; }
    }));

    emailsSent = sendResults.filter(r => r === 'ok').length;
    sendResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
  } catch (e) {
    errors.push({ type: 'fatal', error: e.message });
  }

  res.status(200).json({ emailsSent, emailCap: EMAIL_CAP, errors, timestamp: new Date().toISOString() });
}
