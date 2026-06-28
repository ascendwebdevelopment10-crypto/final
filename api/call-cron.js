import twilio from 'twilio';
import { isSuppressed } from '../lib/store.js';
import { createClient } from '@vercel/kv';

export const config = { maxDuration: 60 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const CALL_CAP = 50;
const FETCH_LIMIT = 25;

const SEARCH_QUERIES = [
'restaurant','gym fitness yoga','salon barbershop spa','real estate agent',
'landscaping lawn care','plumbing hvac electrical','roofing cleaning pest control',
'dental chiropractic healthcare','auto repair mechanic','childcare daycare tutoring',
'photography event planning catering','moving delivery courier','church nonprofit organization',
'law firm attorney','accounting cpa','insurance agency','veterinarian'
];

const PAIN_POINTS = [
'missing an online booking portal',
'not being mobile-friendly',
'lacking local Google review integration',
'having zero search visibility for local keywords',
'missing a clear contact or quote request form',
'not showing up in Google Maps results'
];

function pickPainPoint(contact) {
if (!contact.website_url || contact.website_url.trim() === '') {
return 'having no website or online presence at all';
}
return PAIN_POINTS[Math.floor(Math.random() * PAIN_POINTS.length)];
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

function normalizeContact(place) {
return {
first_name: (place.name || '').split(' ')[0] || 'there',
organization_name: place.name || '',
phone: place.phone || null,
website_url: place.website || '',
industry: place.type || (Array.isArray(place.subtypes) ? place.subtypes[0] : place.subtypes) || 'local business'
};
}

function buildBlandPrompt(contact, painPoint) {
const firstName = contact.first_name || 'there';
const company = contact.organization_name || 'your business';
const industry = contact.industry || 'local business';
return 'You are Alex, a senior Local Growth Advisor at Ascend Web Development. Your voice is calm, approachable, and professional — like a friendly local business consultant, NOT a telemarketer. Follow this conversation flow:\n\n' +
'1. OPENING: Confirm you have the owner or manager. Say: "Hey ' + firstName + ', it is Alex over at Ascend Web Development. I hope your day is going smoothly so far?" Wait for reply. Then say: "Great. Hey, I will be brief because I know you are likely out in the field or dealing with clients. I was searching for local ' + industry + ' teams in the area and came across ' + company + '. I noticed that your digital setup is currently ' + painPoint + '. I wanted to reach out directly because when local customers are actively looking to hire a ' + industry + ' provider right now, a glitch like that usually causes them to bounce to a competitor. Just out of curiosity, who handles your digital presence or website right now?"\n\n' +
'2. DIAGNOSTIC: Acknowledge their answer. Then say: "The main reason I wanted to wave a flag is that over 80% of local searches for ' + industry + ' services happen on mobile devices while people are in a hurry. Right now, because of that ' + painPoint + ' issue, it is making it pretty difficult for a new client to get a quote or call your team. We specialize in putting those conversion fixes in place so local businesses actually capture every single lead hitting their page."\n\n' +
'3. CTA: Say: "Look, I know you are running a million miles an hour. What we usually do is have our technical director pull a quick 10-minute visual blueprint of your site local footprint. We will show you exactly how to patch that ' + painPoint + ' error so you stop leaking leads to other ' + industry + ' companies. Would you be open to a quick 10-minute screen-share later this week, say Thursday or Friday morning, just to take a look at the data?"\n\n' +
'4. OBJECTIONS:\n' +
'- If "send an email": Say "I can absolutely drop you an email. But honestly, without looking at the live mobile viewport or search layout together, a generic email won not show you where the leak is. It is a dead-simple 10-minute view. Is there a morning that works best?"\n' +
'- If "we get word-of-mouth business": Say "That is awesome — word-of-mouth means you run a great operation. The only reason I called is that when those referrals look you up online to verify your number or hours, that ' + painPoint + ' issue makes it look like you might be closed or out of business. It is worth fixing just to protect your existing reputation. Does a quick morning slot this week hurt to check out?"\n\n' +
'5. CLOSE: If they agree, ask for their email to send the calendar link. Say: "Perfect, I have locked you in. You will see a placeholder from Ascend Web Development in your inbox in about two minutes. Appreciate the time ' + firstName + ', talk soon!" Then end the call.\n\n' +
'IMPORTANT: Use natural human speech. Say "gotcha", "makes sense", "sure" occasionally. Never use marketing jargon like synergy or scaling. Keep it conversational and brief.';
}

async function isPhoneSuppressed(phone) {
try {
const key = 'suppress:phone:' + phone.replace(/\D/g, '').slice(-10);
const val = await kv.get(key);
return !!val;
} catch { return false; }
}

async function logCall(data) {
try {
const entry = JSON.stringify({ ...data, timestamp: Date.now() });
await kv.lpush('calls:log', entry);
await kv.incr('stats:calls_made');
} catch(e) { console.error('logCall error:', e.message); }
}

async function makeCall(contact, painPoint) {
try {
if (!contact.phone) return null;
const suppressed = await isPhoneSuppressed(contact.phone);
if (suppressed) return null;

const prompt = buildBlandPrompt(contact, painPoint);

const res = await fetch('https://api.bland.ai/v1/calls', {
method: 'POST',
headers: {
'authorization': BLAND_API_KEY,
'Content-Type': 'application/json'
},
body: JSON.stringify({
phone_number: contact.phone,
task: prompt,
model: 'enhanced',
language: 'en',
voice: 'nat',
max_duration: 300,
wait_for_greeting: true,
record: true,
amd: true,
voicemail_message: 'Hey ' + contact.first_name + ', this is Alex from Ascend Web Development. I was looking for local ' + contact.industry + ' providers in the area and noticed something on your digital profile I wanted to flag for you. Give me a call back at your convenience or check your texts from us. Thanks!',
webhook: 'https://final-phi-swart.vercel.app/api/call-webhook',
metadata: {
contact_name: contact.organization_name,
contact_phone: contact.phone,
industry: contact.industry,
pain_point: painPoint
}
})
});

if (!res.ok) {
const err = await res.text();
return { error: err };
}

const data = await res.json();
await logCall({
callId: data.call_id,
to: contact.phone,
contactName: contact.organization_name,
industry: contact.industry,
painPoint
});
return 'ok';
} catch(e) {
return { error: e.message };
}
}

export default async function handler(req, res) {
if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
const auth = req.headers['authorization'];
if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

const errors = [];
let callsMade = 0;

try {
const hour = new Date().getUTCHours();
const qi = Math.floor(hour / 2) % SEARCH_QUERIES.length;
const [b1, b2] = await Promise.all([
fetchOutscraperLeads(SEARCH_QUERIES[qi], FETCH_LIMIT),
fetchOutscraperLeads(SEARCH_QUERIES[(qi+1) % SEARCH_QUERIES.length], FETCH_LIMIT)
]);

const leads = [...b1, ...b2].map(normalizeContact).filter(c => c.phone).slice(0, CALL_CAP);

const results = await Promise.all(leads.map(async (contact) => {
const painPoint = pickPainPoint(contact);
return makeCall(contact, painPoint);
}));

callsMade = results.filter(r => r === 'ok').length;
results.filter(r => r?.error).forEach(r => errors.push({ type: 'call', error: r.error }));

} catch(e) {
errors.push({ type: 'fatal', error: e.message });
}

res.status(200).json({ callsMade, callCap: CALL_CAP, errors, timestamp: new Date().toISOString() });
}
