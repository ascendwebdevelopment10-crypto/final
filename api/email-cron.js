import Anthropic from '@anthropic-ai/sdk';
import { sendEmail } from '../lib/mailer.js';
import { logEmail, isSuppressed } from '../lib/store.js';

export const config = { maxDuration: 300 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.GMAIL_USER;
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const EMAIL_CAP = 6;
const FETCH_LIMIT = 15;
const OUTSCRAPER_TIMEOUT_MS = 45000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 5;

// Business names/brands we never contact, regardless of what query surfaces them.
// The Joint Chiropractic is a large nationwide franchise - Outscraper's chiropractor
// queries kept resurfacing different locations of the same chain across cities.
const EXCLUDED_NAME_PATTERNS = [
        /the\s*joint\s*chiropractic/i,
        /\bthe\s*joint\b/i,
      ];
function isExcludedBusiness(name) {
        const n = name || '';
        return EXCLUDED_NAME_PATTERNS.some(p => p.test(n));
}

// Same HIGH_RESPONSE industries as cron.js — owner-operated, budget for marketing
const HIGH_RESPONSE_QUERIES = [
        'plumber plumbing contractor',
        'hvac heating cooling contractor',
        'electrician electrical contractor',
        'roofing contractor roofer',
        'general contractor home remodeling',
        'pest control exterminator',
        'cleaning service maid service',
        'landscaping lawn care',
        'tree service arborist',
        'painting contractor',
        'dentist dental office',
        'chiropractor chiropractic',
        'optometrist eye care',
        'physical therapy clinic',
        'veterinarian animal hospital',
        'law firm attorney solo practice',
        'accounting cpa bookkeeping',
        'insurance agency broker',
        'mortgage broker loan officer',
        'real estate agent realtor',
        'personal trainer fitness studio',
        'yoga studio pilates',
        'salon barbershop hair stylist',
        'spa massage therapy',
        'auto repair mechanic shop',
        'car detailing auto detailing',
        'tutoring learning center',
        'photography studio photographer',
        'wedding planner event planner',
        'catering company',
      ];

// 55-city pool for geographic spread
const US_CITIES = [
        'New York NY','Los Angeles CA','Chicago IL','Houston TX','Phoenix AZ',
        'Philadelphia PA','San Antonio TX','San Diego CA','Dallas TX','San Jose CA',
        'Austin TX','Jacksonville FL','Fort Worth TX','Columbus OH','Charlotte NC',
        'Indianapolis IN','San Francisco CA','Seattle WA','Denver CO','Nashville TN',
        'Oklahoma City OK','El Paso TX','Washington DC','Las Vegas NV','Louisville KY',
        'Memphis TN','Portland OR','Baltimore MD','Milwaukee WI','Albuquerque NM',
        'Tucson AZ','Fresno CA','Sacramento CA','Mesa AZ','Kansas City MO',
        'Atlanta GA','Omaha NE','Colorado Springs CO','Raleigh NC','Miami FL',
        'Minneapolis MN','Tampa FL','New Orleans LA','Cleveland OH','Bakersfield CA',
        'Aurora CO','Anaheim CA','Corpus Christi TX','Riverside CA','St Louis MO',
        'Pittsburgh PA','Orlando FL','Scottsdale AZ','Salt Lake City UT','Richmond VA',
      ];

const SERVICES = ['website', 'ads', 'app'];
function pickService() { return SERVICES[Math.floor(Math.random() * SERVICES.length)]; }
function pickCity() { return US_CITIES[Math.floor(Math.random() * US_CITIES.length)]; }

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
        const city = pickCity();
        const params = new URLSearchParams({
                  query: query + ' in ' + city,
                  limit,
                  language: 'en',
                  region: 'us',
                  fields: 'name,full_address,phone,website,type,subtypes',
                  async: 'false'
        });
        // BUGFIX: this request has no timeout. Outscraper's synchronous mode can hang or
  // take far longer than expected, which was silently killing the whole cron run
  // (and therefore every email in it) once Vercel's function timeout was hit.
  const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), OUTSCRAPER_TIMEOUT_MS);
        try {
                  const res = await fetch('https://api.app.outscraper.com/maps/search-v3?' + params, {
                              headers: { 'X-API-KEY': OUTSCRAPER_API_KEY },
                              signal: controller.signal
                  });
                  if (!res.ok) throw new Error('Outscraper error: ' + res.status);
                  const data = await res.json();
                  const all = data?.data?.[0] || [];
                  return all.filter(p => p.website && p.website.trim() !== '' && !isExcludedBusiness(p.name));
        } catch (e) {
                  if (e.name === 'AbortError') {
                              throw new Error('Outscraper timed out after ' + (OUTSCRAPER_TIMEOUT_MS / 1000) + 's for query: ' + query);
                  }
                  throw e;
        } finally {
                  clearTimeout(timer);
        }
}

async function scrapeEmail(url) {
        try {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 2000);
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
        let serviceDesc;
        if (service === 'website') {
                  serviceDesc = 'SEO-optimized websites that drive more Google traffic and make businesses look professional online';
        } else if (service === 'ads') {
                  serviceDesc = 'Google and Meta ad campaigns that bring in real paying customers — targeted, measurable, and ROI-focused';
        } else {
                  serviceDesc = 'custom mobile apps — online booking, loyalty rewards, push notifications';
        }
        const prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + ' in the ' + industry + ' industry. We are Ascend Web Development. We build ' + serviceDesc + '. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ty Smith, Owner - Ascend Web Development. IMPORTANT: Do not use any placeholder text such as [Your Name], [Name], [Company], [Phone], [Link], or any text in brackets. Output only the subject line and email body, nothing else.';
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
            const queryIndex = Math.floor(hour / 2) % HIGH_RESPONSE_QUERIES.length;
            const q1 = HIGH_RESPONSE_QUERIES[queryIndex];
            const q2 = HIGH_RESPONSE_QUERIES[(queryIndex + 1) % HIGH_RESPONSE_QUERIES.length];

          // BUGFIX: was Promise.all, so one slow/hanging Outscraper query took the whole
          // run down with it and no emails ever got sent. Promise.allSettled lets a failed
          // or timed-out batch degrade gracefully instead of killing the other batch.
          const [batch1Result, batch2Result] = await Promise.allSettled([
                      fetchLeadsWithWebsites(q1, FETCH_LIMIT),
                      fetchLeadsWithWebsites(q2, FETCH_LIMIT)
                    ]);

          const batch1 = batch1Result.status === 'fulfilled' ? batch1Result.value : [];
            const batch2 = batch2Result.status === 'fulfilled' ? batch2Result.value : [];
            if (batch1Result.status === 'rejected') {
                        errors.push({ type: 'fetch_leads', query: q1, error: batch1Result.reason?.message || String(batch1Result.reason) });
            }
            if (batch2Result.status === 'rejected') {
                        errors.push({ type: 'fetch_leads', query: q2, error: batch2Result.reason?.message || String(batch2Result.reason) });
            }

          const leads = [...batch1, ...batch2].map(normalizeContact);

          const emailResults2 = await Promise.all(leads.map(c => scrapeEmail(c.website_url)));
            leads.forEach((c, i) => { c.email = emailResults2[i] || null; });

          const emailableLeads = leads.filter(c => c.email).slice(0, EMAIL_CAP);

          const emailContents = await Promise.all(
                      emailableLeads.map(c => generateEmail(c).catch(e => ({ error: e.message })))
                    );

          const sendResults = await Promise.all(emailableLeads.map(async (contact, i) => {
                      const content = emailContents[i];
                      if (content.error) return { error: content.error };
                      try {
                                    const suppressed = await isSuppressed(contact.email);
                                    if (suppressed) return null;
                                    const { subject, body, service } = content;
                                    const footer = '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=' + encodeURIComponent(contact.email) + '">Unsubscribe</a>';
                                    const sendOptions = {
                                                    from: FROM_EMAIL, to: contact.email, subject,
                                                    html: (body + footer).replace(/\n/g, '<br>'),
                                                    reply_to: FROM_EMAIL
                                    };
                                    if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
                                    await sendEmail(sendOptions);
                                    await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: 'needs_upgrade', service });
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
