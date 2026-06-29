import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { logEmail, isSuppressed } from '../lib/store.js';

export const config = { maxDuration: 60 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const EMAIL_CAP = 25;
const FETCH_LIMIT = 10;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 5;

const SEARCH_QUERIES = [
'dental office','law firm attorney','accounting cpa','insurance agency',
'real estate agency','mortgage broker','veterinarian','optometrist',
'physical therapy','marketing agency','IT support company','printing company',
'hotel bed breakfast','wedding venue','car dealership'
];

const SERVICES = ['website', 'ads', 'app'];
function pickService() {
return SERVICES[Math.floor(Math.random() * SERVICES.length)];
}

function cleanPlaceholders(text) {
return text
.replace(/\[your name\]/gi, 'Ascend Web Development')
.replace(/\[name\]/gi, 'Ascend Web Development')
.replace(/\(your name\)/gi, 'Ascend Web Development')
.replace(/\[your company\]/gi, 'Ascend Web Development')
.replace(/\[company name\]/gi, 'Ascend Web Development')
.replace(/\[your (?:phone|number|email|website|link|url)[^\]]*\]/gi, '')
.replace(/\[[^\]]{1,40}\]/g, '')
.trim();
}

async function fetchLeadsWithWebsites(query, limit) {
const params = new URLSearchParams({
query: query + ' in United States',
limit: limit,
language: 'en',
region: 'us',
fields: 'name,full_address,phone,website,type,subtypes',
async: 'false'
});
const res = await fetch('https://api.app.outscraper.com/maps/search-v3?' + params, {
headers: { 'X-API-KEY': OUTSCRAPER_API_KEY }
});
if (!res.ok) throw new Error('Outscraper error: ' + res.status);
const data = await res.json();
const all = data?.data?.[0] || [];
return all.filter(p => p.website && p.website.trim() !== '');
}

async function scrapeEmail(url) {
try {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);
const res = await fetch(url, {
signal: controller.signal,
headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
});
clearTimeout(timer);
if (!res.ok) return null;
const html = await res.text();
const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const matches = [...new Set(html.match(emailRegex) || [])];
const junk = ['example.','sentry.','w3.org','schema.','wix','squarespace','shopify',
'google.','facebook.','twitter.','instagram.','youtube.','.png','.jpg','.svg','.gif','.css','.js'];
const clean = matches.filter(e => !junk.some(j => e.toLowerCase().includes(j)));
const preferred = clean.find(e => /^(info|contact|hello|sales|office|admin|support|team|booking)@/i.test(e));
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

async function generateEmail(contact) {
const firstName = contact.first_name || 'there';
const company = contact.organization_name || 'your business';
const industry = contact.industry || 'your industry';
const service = pickService();
let prompt;
if (service === 'website') {
prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + ' in the ' + industry + ' industry. We are Ascend Web Development. We build SEO-optimized websites that drive more Google traffic and make businesses look professional online. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ascend Web Development. IMPORTANT: Do not use any placeholder text such as [Your Name], [Name], [Company], [Phone], [Link], or any text in brackets. Output only the subject line and email body, nothing else.';
} else if (service === 'ads') {
prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + ' in the ' + industry + ' industry. We are Ascend Web Development. We run Google and Meta ads that bring in real paying customers — targeted, measurable, and ROI-focused. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ascend Web Development. IMPORTANT: Do not use any placeholder text such as [Your Name], [Name], [Company], [Phone], [Link], or any text in brackets. Output only the subject line and email body, nothing else.';
} else {
prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + ' in the ' + industry + ' industry. We are Ascend Web Development. We build custom mobile apps — online booking, loyalty rewards, push notifications. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ascend Web Development. IMPORTANT: Do not use any placeholder text such as [Your Name], [Name], [Company], [Phone], [Link], or any text in brackets. Output only the subject line and email body, nothing else.';
}
const msg = await anthropic.messages.create({
model: ANTHROPIC_MODEL, max_tokens: 350,
messages: [{ role: 'user', content: prompt }]
});
const raw = msg.content[0].text;
const text = cleanPlaceholders(raw);
const lines = text.split('\n');
const subjectLine = lines.find(l => l.startsWith('Subject:'));
const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question about your business';
const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
return { subject, body, service };
}

export default async function handler(req, res) {
if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
const auth = req.headers['authorization'];
if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

let emailsSent = 0;
const errors = [];

try {
const hour = new Date().getUTCHours();
const queryIndex = Math.floor(hour / 2) % SEARCH_QUERIES.length;
const q1 = SEARCH_QUERIES[queryIndex];
const q2 = SEARCH_QUERIES[(queryIndex + 1) % SEARCH_QUERIES.length];
const q3 = SEARCH_QUERIES[(queryIndex + 2) % SEARCH_QUERIES.length];

const [batch1, batch2, batch3] = await Promise.all([
fetchLeadsWithWebsites(q1, FETCH_LIMIT),
fetchLeadsWithWebsites(q2, FETCH_LIMIT),
fetchLeadsWithWebsites(q3, FETCH_LIMIT)
]);

const leads = [...batch1, ...batch2, ...batch3].map(normalizeContact);

const emailResults = await Promise.all(leads.map(c => scrapeEmail(c.website_url)));
leads.forEach((c, i) => { c.email = emailResults[i] || null; });

const emailableLeads = leads.filter(c => c.email).slice(0, EMAIL_CAP);

const [emailContents] = await Promise.all([
Promise.all(emailableLeads.map(c => generateEmail(c).catch(e => ({ error: e.message }))))
]);

const sendResults = await Promise.all(emailableLeads.map(async (contact, i) => {
const content = emailContents[i];
if (content.error) return { error: content.error };
try {
const suppressed = await isSuppressed(contact.email);
if (suppressed) return null;
const { subject, body, service } = content;
const footer = '\n\n--\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=' + encodeURIComponent(contact.email) + '">Unsubscribe</a>';
const sendOptions = {
from: FROM_EMAIL, to: contact.email, subject,
html: (body + footer).replace(/\n/g, '<br>'),
reply_to: FROM_EMAIL
};
if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
await resend.emails.send(sendOptions);
await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: 'needs_website', service });
return 'ok';
} catch (e) {
return { error: e.message };
}
}));

emailsSent = sendResults.filter(r => r === 'ok').length;
sendResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
} catch (e) {
errors.push({ type: 'fatal', error: e.message });
}

res.status(200).json({ emailsSent, emailCap: EMAIL_CAP, errors, timestamp: new Date().toISOString() });
}
