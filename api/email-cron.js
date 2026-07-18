import Anthropic from '@anthropic-ai/sdk';
import { sendEmail, MAIL_PROVIDER } from '../lib/mailer.js';
import { logEmail, isSuppressed, logNotSent, wasEmailed, markEmailed, wasHunterQueued, markHunterQueued, getTotalStats } from '../lib/store.js';
import { tokenFor } from '../lib/sign.js';
import { isLikelyRealEmail } from '../lib/email-validate.js';
import { fetchOsmLeads, OSM_TAGS } from '../lib/leads.js';
import { hunterConfigured, ensureHunterSequenceConfigured, addHunterRecipients, HUNTER_SEQUENCE_ID } from '../lib/hunter.js';

export const config = { maxDuration: 300 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.GMAIL_USER;
const REPLY_TO = process.env.REPLY_TO || FROM_EMAIL;
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const DEFAULT_EMAILS_PER_RUN = MAIL_PROVIDER === 'ses' ? 12 : 7;
const DEFAULT_DAILY_EMAIL_CAP = MAIL_PROVIDER === 'ses' ? 150 : 95;
const EMAIL_CAP = Math.max(1, Math.min(25, parseInt(process.env.EMAILS_PER_RUN || DEFAULT_EMAILS_PER_RUN, 10)));
const DAILY_EMAIL_CAP = Math.max(1, Math.min(1000, parseInt(process.env.DAILY_EMAIL_CAP || DEFAULT_DAILY_EMAIL_CAP, 10)));
const SEND_DELAY_MS = Math.max(250, Math.min(10000, parseInt(process.env.EMAIL_SEND_DELAY_MS || '1000', 10)));
const HUNTER_QUEUE_PER_RUN = Math.max(1, Math.min(50, parseInt(process.env.HUNTER_QUEUE_PER_RUN || '20', 10)));
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://final-phi-swart.vercel.app';
const FETCH_LIMIT = 20;
const OUTSCRAPER_TIMEOUT_MS = 45000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 0;  // BCC preview copies disabled to conserve Resend quota; sent mail is visible in the dashboard

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
                  const timer = setTimeout(() => controller.abort(), 7000);
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
                                      'google.','facebook.','twitter.','instagram.','youtube.','.png','.jpg','.jpeg','.svg','.gif','.webp','.avif','.ico','.woff','.css','.js'];
                  const clean = matches.filter(e => !junk.some(j => e.toLowerCase().includes(j))).filter(isLikelyRealEmail);
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
        const prompt = 'Write a short cold email (under 130 words) to ' + firstName + ' at ' + company + ' (a ' + industry + ' business). You are Ty Smith, owner of Ascend Web Development. Lead by offering a FREE, no-obligation audit of their website: you took a quick look and spotted a couple of things that are likely costing them calls/customers, and you will send the full audit if they just reply. Make it about the specific RESULT for their type of business, never say "we build websites" as the pitch. Warm, human, no fluff, no hype, no hard sell. The only ask is a reply to get the free audit. Subject line first as "Subject: ...". Sign off as: Ty Smith, Owner - Ascend Web Development. Do not use any placeholder text in brackets. Output only the subject line and email body.';
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

  // Pause outbound outreach on Sundays (Mountain Time).
  const mtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
  if (mtDay === 'Sun') { res.status(200).json({ skipped: 'sunday', timestamp: new Date().toISOString() }); return; }

  let emailsSent = 0;
        const errors = [];

  try {
            const useHunter = hunterConfigured();
            const currentStats = await getTotalStats();
            const remainingToday = Math.max(0, DAILY_EMAIL_CAP - (currentStats.todayEmailSent || 0));
            const runCap = useHunter ? HUNTER_QUEUE_PER_RUN : Math.min(EMAIL_CAP, remainingToday);
            if (!useHunter && runCap === 0) {
              res.status(200).json({ skipped: 'daily_cap_reached', provider: MAIL_PROVIDER, dailyEmailCap: DAILY_EMAIL_CAP, emailsSent: 0, timestamp: new Date().toISOString() });
              return;
            }
            const useOutscraper = process.env.USE_OUTSCRAPER === 'true' && process.env.OUTSCRAPER_API_KEY;
            const SRC = useOutscraper ? HIGH_RESPONSE_QUERIES : OSM_TAGS;
            const fetchLeads = useOutscraper ? fetchLeadsWithWebsites : fetchOsmLeads;
            const queryIndex = Math.floor(Math.random() * SRC.length);
            const q1 = SRC[queryIndex];
            const q2 = SRC[(queryIndex + 1) % SRC.length];
            const q3 = SRC[(queryIndex + 2) % SRC.length];

          // BUGFIX: was Promise.all, so one slow/hanging Outscraper query took the whole
          // run down with it and no emails ever got sent. Promise.allSettled lets a failed
          // or timed-out batch degrade gracefully instead of killing the other batch.
          const [batch1Result, batch2Result, batch3Result] = await Promise.allSettled([
                      fetchLeads(q1, FETCH_LIMIT),
                      fetchLeads(q2, FETCH_LIMIT),
                      fetchLeads(q3, FETCH_LIMIT)
                    ]);

          const batch1 = batch1Result.status === 'fulfilled' ? batch1Result.value : [];
            const batch2 = batch2Result.status === 'fulfilled' ? batch2Result.value : [];
            const batch3 = batch3Result.status === 'fulfilled' ? batch3Result.value : [];
            if (batch1Result.status === 'rejected') {
                        errors.push({ type: 'fetch_leads', query: q1, error: batch1Result.reason?.message || String(batch1Result.reason) });
            }
            if (batch2Result.status === 'rejected') {
                        errors.push({ type: 'fetch_leads', query: q2, error: batch2Result.reason?.message || String(batch2Result.reason) });
            }
            if (batch3Result.status === 'rejected') {
                        errors.push({ type: 'fetch_leads', query: q3, error: batch3Result.reason?.message || String(batch3Result.reason) });
            }

          const leads = [...batch1, ...batch2, ...batch3].map(normalizeContact);

          const emailResults2 = await Promise.all(leads.map(c => scrapeEmail(c.website_url)));
            leads.forEach((c, i) => { c.email = emailResults2[i] || null; });

          const emailCandidates = leads.filter(c => c.email);
          const emailableLeads = [];
          for (const c of emailCandidates) {
            if (emailableLeads.length >= runCap) break;
            if (await wasEmailed(c.email)) continue;   // never email the same business twice
            if (useHunter && await wasHunterQueued(c.email)) continue;
            emailableLeads.push(c);
          }

          if (useHunter) {
            const eligible = [];
            for (const contact of emailableLeads) {
              if (await isSuppressed(contact.email)) {
                await logNotSent(1);
                continue;
              }
              eligible.push(contact);
            }

            const setup = await ensureHunterSequenceConfigured();
            const queued = await addHunterRecipients(eligible.map(contact => contact.email));
            for (const contact of eligible) await markHunterQueued(contact.email);

            res.status(200).json({
              provider: 'hunter',
              sequenceId: HUNTER_SEQUENCE_ID,
              sequenceActive: setup.active,
              sequenceConfigured: setup.configured,
              queuedToHunter: queued.submitted,
              note: setup.active
                ? 'Recipients were queued to the active Hunter sequence.'
                : 'Recipients were queued safely. The Hunter sequence is still a draft until you activate it.',
              errors,
              timestamp: new Date().toISOString()
            });
            return;
          }

          const emailContents = await Promise.all(
                      emailableLeads.map(c => generateEmail(c).catch(e => ({ error: e.message })))
                    );

          const sendResults = [];
          for (let i = 0; i < emailableLeads.length; i++) {
            const contact = emailableLeads[i];
            const content = emailContents[i];
            if (content.error) {
              sendResults.push({ error: content.error });
              continue;
            }
            try {
              const suppressed = await isSuppressed(contact.email);
              if (suppressed) {
                await logNotSent(1);
                sendResults.push(null);
                continue;
              }
              const { subject, body, service } = content;
              const token = tokenFor(contact.email);
              const unsubscribeUrl = BASE_URL + '/unsubscribe?e=' + encodeURIComponent(contact.email) + '&t=' + encodeURIComponent(token);
              const footer = '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\nUnsubscribe: ' + unsubscribeUrl;
              const sendOptions = {
                from: FROM_EMAIL,
                to: contact.email,
                subject,
                html: (body + '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="' + unsubscribeUrl + '">Unsubscribe</a>').replace(/\n/g, '<br>'),
                text: body + footer,
                reply_to: REPLY_TO,
                headers: {
                  'List-Unsubscribe': '<' + unsubscribeUrl + '>',
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                }
              };
              if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
              await sendEmail(sendOptions);
              await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: 'needs_upgrade', service });
              await markEmailed(contact.email);
              sendResults.push('ok');
            } catch (e) {
              await logNotSent(1);
              sendResults.push({ error: e.message });
            }
            if (i < emailableLeads.length - 1) {
              await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
            }
          }

          emailsSent = sendResults.filter(r => r === 'ok').length;
            sendResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
  } catch (e) {
            errors.push({ type: 'fatal', error: e.message });
  }

  res.status(200).json({ emailsSent, emailCap: EMAIL_CAP, dailyEmailCap: DAILY_EMAIL_CAP, provider: MAIL_PROVIDER, hunterConfigured: hunterConfigured(), sendDelayMs: SEND_DELAY_MS, errors, timestamp: new Date().toISOString() });
}
