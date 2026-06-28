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

const EMAIL_CAP = 200;
const SMS_CAP = 67;
const FETCH_LIMIT = 30;

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
function pickService() { return SERVICES[Math.floor(Math.random() * SERVICES.length)]; }

function cleanPlaceholders(text) {
return text
.replace(/\[your name\]/gi, 'Ascend Web Development')
.replace(/\[name\]/gi, 'Ascend Web Development')
.replace(/\(your name\)/gi, 'Ascend Web Development')
.replace(/\[your company\]/gi, 'Ascend Web Development')
.replace(/\[company name\]/gi, 'Ascend Web Development')
.replace(/\[your (?:phone|number|email|website|link|url)[^\]]*\]/gi, '')
.replace(/\[[^\]{1,40}\]/g, '')
.trim();
}

async function fetchOutscraperLeads(query, limit) {
const params = new URLSearchParams({
query: query + ' in United States', limit, language: 'en', region: 'us',
fields: 'name,full_address,phone,website,type,subtypes', async: 'false'
});
const res = await fetch('https://api.app.outscraper.com/maps/search-v3?' + params, {
headers: { 'X-API-KEY': OUTSCRAPER_API_KEY }
});
if (!res.ok) throw new Error('Outscraper error: ' + res.status);
const data = await res.json();
return data?.data?.[0] || [];
}

async function scrapeEmail(url) {
try {
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);
const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) return null;
const html = await res.text();
const matches = [...new Set((html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []))];
const junk = ['example.','sentry.','w3.org','schema.','wix','squarespace','shopify','google.','facebook.','twitter.','instagram.','.png','.jpg','.svg','.gif','.css','.js'];
const clean = matches.filter(e => !junk.some(j => e.toLowerCase().includes(j)));
return clean.find(e => /^(info|contact|hello|sales|office|admin|support|booking)@/i.test(e)) || clean[0] || null;
} catch { return null; }
}

function normalizeContact(place) {
return {
first_name: (place.name || '').split(' ')[0] || 'there',
organization_name: place.name || '',
email: null, phone: place.phone || null,
website_url: place.website || '', industry: place.type || place.subtypes || ''
};
}

function hasNoWebsite(c) { return !c.website_url || c.website_url.trim() === ''; }

async function generateEmail(contact, segment) {
const service = pickService();
const firstName = contact.first_name || 'there';
const company = contact.organization_name || 'your business';
const industry = contact.industry || 'your industry';
const serviceDesc = service === 'website'
? 'SEO-optimized websites that drive more Google traffic'
: service === 'ads'
? 'Google and Meta ad campaigns that drive real paying customers'
: 'custom mobile apps with online booking, loyalty rewards, and push notifications';
const prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + (segment === 'no_website' ? ' who has no website' : ' in the ' + industry + ' industry') + '. We are Ascend Web Development. We build ' + serviceDesc + '. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ascend Web Development. No placeholders in brackets. Output only subject and body.';
const msg = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
const text = cleanPlaceholders(msg.content[0].text);
const lines = text.split('\n');
const subjectLine = lines.find(l => l.startsWith('Subject:'));
const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question about your business';
const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
return { subject, body, service };
}

async function generateSms(contact, segment) {
const service = pickService();
const firstName = contact.first_name || 'there';
const company = contact.organization_name || 'your business';
const industry = contact.industry || 'your industry';
const serviceDesc = service === 'website' ? 'websites that get more Google traffic'
: service === 'ads' ? 'Google and Meta ads that bring paying customers'
: 'custom mobile apps with booking and loyalty features';
const prompt = 'Write a single SMS (under 160 chars) to ' + firstName + ' at ' + company + (segment === 'no_website' ? ' (no website)' : ' in ' + industry) + '. We are Ascend Web Development. We build ' + serviceDesc + '. CTA to reply. No emojis. Sign off: - Ascend Web Dev. No brackets/placeholders. Output ONLY the SMS text.';
const msg = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 100, messages: [{ role: 'user', content: prompt }] });
let text = cleanPlaceholders(msg.content[0].text.trim().replace(/^["']|["']$/g, '').trim());
if (text.length > 160) text = text.substring(0, 157) + '...';
return { text, service };
}

export default async function handler(req, res) {
if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
const auth = req.headers['authorization'];
if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

const errors = [];

try {
const hour = new Date().getUTCHours();
const qi = Math.floor(hour / 2) % SEARCH_QUERIES.length;
const [b1, b2, b3] = await Promise.all([
fetchOutscraperLeads(SEARCH_QUERIES[qi], FETCH_LIMIT),
fetchOutscraperLeads(SEARCH_QUERIES[(qi+1) % SEARCH_QUERIES.length], FETCH_LIMIT),
fetchOutscraperLeads(SEARCH_QUERIES[(qi+2) % SEARCH_QUERIES.length], FETCH_LIMIT)
]);

const allLeads = [...b1, ...b2, ...b3].map(normalizeContact).filter(c => c.phone);
const noWebLeads = allLeads.filter(c => hasNoWebsite(c));
const hasWebLeads = allLeads.filter(c => !hasNoWebsite(c));

const toScrape = hasWebLeads.slice(0, 20);
const scraped = await Promise.all(toScrape.map(c => scrapeEmail(c.website_url)));
toScrape.forEach((c, i) => { c.email = scraped[i] || null; });

const leads = [...noWebLeads, ...hasWebLeads];
const emailLeads = leads.filter(c => c.email).slice(0, EMAIL_CAP);
const smsLeads = leads.slice(0, SMS_CAP);

const [emailContents, smsContents] = await Promise.all([
Promise.all(emailLeads.map(c => generateEmail(c, hasNoWebsite(c) ? 'no_website' : 'needs_app').catch(e => ({ error: e.message })))),
Promise.all(smsLeads.map(c => generateSms(c, hasNoWebsite(c) ? 'no_website' : 'needs_app').catch(e => ({ error: e.message }))))
]);

const emailResults = await Promise.all(emailLeads.map(async (contact, i) => {
const content = emailContents[i];
if (content.error) return { error: content.error };
try {
const suppressed = await isSuppressed(contact.email);
if (suppressed) return null;
const { subject, body, service } = content;
const footer = '\n\n--\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=' + encodeURIComponent(contact.email) + '">Unsubscribe</a>';
const sendOptions = { from: FROM_EMAIL, to: contact.email, subject, html: (body + footer).replace(/\n/g, '<br>'), reply_to: FROM_EMAIL };
if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
await resend.emails.send(sendOptions);
await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: hasNoWebsite(contact) ? 'no_website' : 'needs_app', service });
return 'ok';
} catch(e) { return { error: e.message }; }
}));

const smsResults = await Promise.all(smsLeads.map(async (contact, i) => {
const content = smsContents[i];
if (content.error) return { error: content.error };
try {
const { text, service } = content;
await twilioClient.messages.create({ body: text, from: TWILIO_FROM, to: contact.phone });
await logSms({ to: contact.phone, body: text, contactName: contact.organization_name, timestamp: Date.now(), segment: hasNoWebsite(contact) ? 'no_website' : 'needs_app', service });
return 'ok';
} catch(e) { return { error: e.message }; }
}));

const emailsSent = emailResults.filter(r => r === 'ok').length;
const smsSent = smsResults.filter(r => r === 'ok').length;
emailResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
smsResults.filter(r => r?.error).forEach(r => errors.push({ type: 'sms', error: r.error }));

res.status(200).json({ emailsSent, smsSent, emailCap: EMAIL_CAP, smsCap: SMS_CAP, errors, timestamp: new Date().toISOString() });
} catch(e) {
errors.push({ type: 'fatal', error: e.message });
res.status(200).json({ emailsSent: 0, smsSent: 0, errors, timestamp: new Date().toISOString() });
}
}
