import twilio from 'twilio';
import { logSms } from '../lib/store.js';
import { kv } from '@vercel/kv';
import { fetchOsmLeads, OSM_TAGS } from '../lib/leads.js';

export const config = { maxDuration: 300 };

// SMS ENGINE. Uses the FREE OpenStreetMap lead source (never paid Outscraper).
// Email is handled entirely by email-cron.js. No follow-ups (cost control).
const CRON_SECRET = process.env.CRON_SECRET;

const SMS_CAP = 10;     // up to 10 texts per run
const FETCH_LIMIT = 20;

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

function isTollFree(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return /^1?(800|844|855|866|877|888)/.test(digits);
}

function normalizeContact(place) {
  return {
    first_name: (place.name || '').split(' ')[0] || 'there',
    organization_name: place.name || '',
    phone: place.phone || null,
    website_url: place.website || '',
    industry: place.type || place.subtypes || ''
  };
}

function hasNoWebsite(c) { return !c.website_url || c.website_url.trim() === ''; }

function generateSms(contact, segment) {
  const company = contact.organization_name || 'your business';
  const text = segment === 'no_website'
    ? `Hi, it's Ty at Ascend Web Dev. ${company} came up with no website - I put together a quick free mockup of one that could bring you more customers. Want me to send it over?`
    : `Hi, it's Ty at Ascend Web Dev. I ran a quick free audit of ${company}'s site & noticed a few things that may be costing you customers. Want me to send it over?`;
  return { text, service: 'website' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

  // Take Sundays off (Mountain Time).
  const mtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
  if (mtDay === 'Sun') { res.status(200).json({ skipped: 'sunday', timestamp: new Date().toISOString() }); return; }

  const errors = [];
  let smsSent = 0;

  try {
    const qi = Math.floor(Math.random() * OSM_TAGS.length);
    const batches = await Promise.allSettled([
      fetchOsmLeads(OSM_TAGS[qi], FETCH_LIMIT),
      fetchOsmLeads(OSM_TAGS[(qi + 1) % OSM_TAGS.length], FETCH_LIMIT),
      fetchOsmLeads(OSM_TAGS[(qi + 2) % OSM_TAGS.length], FETCH_LIMIT)
    ]);
    const fetched = batches.flatMap(b => b.status === 'fulfilled' ? b.value : []).map(normalizeContact);

    const seenPhones = new Set();
    const leads = fetched.filter(c => {
      if (!c.phone) return false;
      const n = c.phone.replace(/\D/g, '');
      if (!n || seenPhones.has(n)) return false;
      if (isTollFree(c.phone)) return false;
      seenPhones.add(n);
      return true;
    });

    const smsLeads = [];
    for (const c of leads) {
      if (smsLeads.length >= SMS_CAP) break;
      const n = c.phone.replace(/\D/g, '');
      if (await kv.sismember('sms:contacted_numbers', n)) continue;   // never text the same number twice
      smsLeads.push(c);
    }
    console.log('[cron]', JSON.stringify({ fetched: fetched.length, withPhone: leads.length, smsLeads: smsLeads.length }));

    const smsResults = await Promise.all(smsLeads.map(async (contact) => {
      try {
        const { text, service } = generateSms(contact, hasNoWebsite(contact) ? 'no_website' : 'needs_upgrade');
        await twilioClient.messages.create({ body: text, from: TWILIO_FROM, to: contact.phone });
        await logSms({ to: contact.phone, body: text, contactName: contact.organization_name, timestamp: Date.now(), segment: hasNoWebsite(contact) ? 'no_website' : 'needs_upgrade', service });
        await kv.sadd('sms:contacted_numbers', (contact.phone || '').replace(/\D/g, ''));
        return 'ok';
      } catch (e) { return { error: e.message }; }
    }));

    smsSent = smsResults.filter(r => r === 'ok').length;
    smsResults.filter(r => r?.error).forEach(r => errors.push({ type: 'sms', error: r.error }));

    res.status(200).json({ emailsSent: 0, smsSent, smsCap: SMS_CAP, errors, timestamp: new Date().toISOString() });
  } catch (e) {
    errors.push({ type: 'fatal', error: e.message });
    res.status(200).json({ emailsSent: 0, smsSent: 0, errors, timestamp: new Date().toISOString() });
  }
}
