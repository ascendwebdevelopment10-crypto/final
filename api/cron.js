import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import twilio from 'twilio';
import { logEmail, logSms, isSuppressed } from '../lib/store.js';

export const config = { maxDuration: 60 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const EMAIL_CAP = 70;
const SMS_CAP = 70;
const FETCH_LIMIT = 10;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 5;

const SEARCH_QUERIES = [
  'restaurant','gym fitness yoga','salon barbershop spa','real estate agent',
  'landscaping lawn care','plumbing hvac electrical','roofing cleaning pest control',
  'dental chiropractic healthcare','auto repair mechanic','childcare daycare tutoring',
  'photography event planning catering','moving delivery courier','church nonprofit organization'
];

const SERVICES = ['website', 'ads', 'app'];
function pickService() {
  return SERVICES[Math.floor(Math.random() * SERVICES.length)];
}

async function fetchOutscraperLeads(query, limit = FETCH_LIMIT) {
  const params = new URLSearchParams({
    query: `${query} in United States`,
    limit: limit,
    language: 'en',
    region: 'us',
    fields: 'name,full_address,phone,website,type,subtypes',
    async: 'false'
  });
  const res = await fetch(`https://api.app.outscraper.com/maps/search-v3?${params}`, {
    headers: { 'X-API-KEY': OUTSCRAPER_API_KEY }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Outscraper error: ${res.status} - ${errText.substring(0, 200)}`);
  }
  const data = await res.json();
  return data?.data?.[0] || [];
}

// Scrape a business website directly to find email addresses - fast, no extra credits
async function scrapeEmailFromWebsite(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; emailbot/1.0)' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Extract emails using regex - match standard email patterns
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const matches = html.match(emailRegex) || [];
    // Filter out common junk: image files, css, js, social domains, examples
    const junkDomains = ['example.com','sentry.io','w3.org','schema.org','wixpress.com','squarespace.com','google.com','facebook.com','twitter.com','instagram.com','png','jpg','svg','gif','css','js'];
    const clean = [...new Set(matches)].filter(e => !junkDomains.some(j => e.toLowerCase().includes(j)));
    // Prefer info@, contact@, hello@ style emails, then anything else
    const preferred = clean.find(e => /^(info|contact|hello|sales|office|admin)@/i.test(e));
    return preferred || clean[0] || null;
  } catch {
    return null;
  }
}

function normalizeContact(place) {
  return {
    first_name: (place.name || '').split(' ')[0] || 'there',
    organization_name: place.name || '',
    email: null,
    phone: place.phone || null,
    website_url: place.website || '',
    industry: place.type || place.subtypes || ''
  };
}

function hasNoWebsite(c) {
  return !c.website_url || c.website_url.trim() === '';
}

async function generateEmail(contact, segment) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your business';
  const industry = contact.industry || 'your industry';
  const service = pickService();
  let prompt;
  if (service === 'website') {
    prompt = `Write a short cold email (under 150 words) to ${firstName} at ${company}${segment === 'no_website' ? ' who has no website' : ' in the ' + industry + ' industry'}. We are Ascend Web Development. We build SEO-optimized websites that bring in more Google traffic and make the business look credible and professional. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Output only the subject line and email body. No intro, no commentary, no placeholders.`;
  } else if (service === 'ads') {
    prompt = `Write a short cold email (under 150 words) to ${firstName} at ${company} in the ${industry} industry. We are Ascend Web Development. We run Google and Meta ad campaigns that drive real paying customers. Mention ROI, targeting, and local reach. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Output only the subject line and email body. No intro, no commentary, no placeholders.`;
  } else {
    prompt = `Write a short cold email (under 150 words) to ${firstName} at ${company} in the ${industry} industry. We are Ascend Web Development. We build custom mobile apps — online booking, loyalty rewards, push notifications. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Output only the subject line and email body. No intro, no commentary, no placeholders.`;
  }
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 350,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = msg.content[0].text;
  const lines = text.split('\n');
  const subjectLine = lines.find(l => l.startsWith('Subject:'));
  const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question about your business';
  const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
  return { subject, body, service };
}

async function generateSms(contact, segment) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your business';
  const industry = contact.industry || 'your industry';
  const service = pickService();
  let prompt;
  if (service === 'website') {
    prompt = `Write a single SMS message to ${firstName} at ${company}${segment === 'no_website' ? ' who has no website' : ' in the ' + industry + ' industry'}. We are Ascend Web Development. We build websites that get more Google traffic and customers. Include a CTA to reply. No emojis. Output ONLY the raw SMS text, nothing else.`;
  } else if (service === 'ads') {
    prompt = `Write a single SMS message to ${firstName} at ${company} in the ${industry} industry. We are Ascend Web Development. We run Google and Meta ads that bring in paying customers. Include a CTA to reply. No emojis. Output ONLY the raw SMS text, nothing else.`;
  } else {
    prompt = `Write a single SMS message to ${firstName} at ${company} in the ${industry} industry. We are Ascend Web Development. We build custom mobile apps with booking, loyalty, and push notifications. Include a CTA to reply. No emojis. Output ONLY the raw SMS text, nothing else.`;
  }
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 120,
    messages: [{ role: 'user', content: prompt }]
  });
  let fullText = msg.content[0].text.trim();
  fullText = fullText.replace(/^(here'?s?\s+(the|your|an?)\s+sms[^:\n]*:|here\s+is\s+the\s+(message|sms)[^:\n]*:|sms[^:\n]*:)\s*/i, '').trim();
  fullText = fullText.replace(/^["'](.+)["']$/s, '$1').trim();
  const sendText = fullText.length > 160 ? fullText.substring(0, 157) + '...' : fullText;
  return { fullText, sendText, service };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) { res.status(401).end('Unauthorized'); return; }

  let emailsSent = 0, smsSent = 0, errors = [];

  try {
    const hour = new Date().getUTCHours();
    const queryIndex = Math.floor(hour / 3) % SEARCH_QUERIES.length;
    const primaryQuery = SEARCH_QUERIES[queryIndex];
    const secondaryQuery = SEARCH_QUERIES[(queryIndex + 1) % SEARCH_QUERIES.length];

    // Fetch leads + scrape emails all in parallel to save time
    const [batch1, batch2] = await Promise.all([
      fetchOutscraperLeads(primaryQuery, FETCH_LIMIT),
      fetchOutscraperLeads(secondaryQuery, FETCH_LIMIT)
    ]);

    const allLeads = [...batch1, ...batch2].map(normalizeContact).filter(c => c.phone);
    const noWebLeads = allLeads.filter(c => hasNoWebsite(c));
    const hasWebLeads = allLeads.filter(c => !hasNoWebsite(c));

    // Scrape emails from business websites in parallel - capped at 5, 4s timeout each
    const toScrape = hasWebLeads.slice(0, 5);
    const scrapedEmails = await Promise.all(toScrape.map(c => scrapeEmailFromWebsite(c.website_url)));
    toScrape.forEach((c, i) => { c.email = scrapedEmails[i] || null; });

    const leads = [...noWebLeads, ...hasWebLeads];

    for (const contact of leads) {
      if (emailsSent >= EMAIL_CAP && smsSent >= SMS_CAP) break;
      const segment = hasNoWebsite(contact) ? 'no_website' : 'needs_app';

      if (contact.email && emailsSent < EMAIL_CAP) {
        try {
          const suppressed = await isSuppressed(contact.email);
          if (!suppressed) {
            const { subject, body, service } = await generateEmail(contact, segment);
            const footer = `\n\n--\nAscend Web Development\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(contact.email)}">Unsubscribe</a>`;
            const sendOptions = {
              from: FROM_EMAIL, to: contact.email, subject,
              html: (body + footer).replace(/\n/g, '<br>'),
              reply_to: FROM_EMAIL
            };
            if (emailsSent < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
            await resend.emails.send(sendOptions);
            await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment, service });
            emailsSent++;
          }
        } catch (e) { errors.push({ type: 'email', to: contact.email, error: e.message }); }
      }

      if (contact.phone && smsSent < SMS_CAP) {
        try {
          const { fullText, sendText, service } = await generateSms(contact, segment);
          await twilioClient.messages.create({ body: sendText, from: TWILIO_FROM, to: contact.phone });
          await logSms({ to: contact.phone, body: fullText, contactName: contact.organization_name, timestamp: Date.now(), segment, service });
          smsSent++;
        } catch (e) { errors.push({ type: 'sms', to: contact.phone, error: e.message }); }
      }
    }
  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({ emailsSent, smsSent, emailCap: EMAIL_CAP, smsCap: SMS_CAP, errors, timestamp: new Date().toISOString() });
}
