import twilio from 'twilio';
import { isSuppressed } from '../lib/store.js';
import { createClient } from '@vercel/kv';

export const config = { maxDuration: 300 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const BASE_URL = process.env.BASE_URL || 'https://final-phi-swart.vercel.app';
const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const CALL_CAP = 15;
const FETCH_LIMIT = 15;

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

      // Build TwiML URL with contact context passed as query params
      const twimlParams = new URLSearchParams({
              firstName: contact.first_name,
              company: contact.organization_name,
              industry: contact.industry,
              painPoint,
              phone: contact.phone
      });
          const twimlUrl = `${BASE_URL}/api/call-twiml?${twimlParams.toString()}`;
          const statusUrl = `${BASE_URL}/api/call-webhook`;

      const call = await twilioClient.calls.create({
              to: contact.phone,
              from: TWILIO_FROM,
              url: twimlUrl,
              statusCallback: statusUrl,
              statusCallbackMethod: 'POST',
              statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
              machineDetection: 'DetectMessageEnd',
              asyncAmd: 'true',
              asyncAmdStatusCallback: `${BASE_URL}/api/call-webhook?amd=1`,
              record: true,
              timeout: 30
      });

      await logCall({
              callId: call.sid,
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
                fetchOutscraperLeads(SEARCH_QUERIES[(qi + 1) % SEARCH_QUERIES.length], FETCH_LIMIT)
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
