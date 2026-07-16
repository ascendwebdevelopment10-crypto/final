import Anthropic from '@anthropic-ai/sdk';
import { isLikelyRealEmail } from '../lib/email-validate.js';
import twilio from 'twilio';
import { logEmail, logSms, isSuppressed, getSmsLog, isExcludedPhone, logNotSent } from '../lib/store.js';
import { kv } from '@vercel/kv';
import { sendEmail } from '../lib/mailer.js';

export const config = { maxDuration: 300 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const SMS_SIGNOFF = '\n- Ty Smith, Owner of Ascend Web Development';

const EMAIL_CAP = 5;
const SMS_CAP = 10;
const FETCH_LIMIT = 15;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
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

// HIGH-RESPONSE industries: owner-operated, direct phone, service-based,
// proven to respond to B2B outreach. Ranked by real-world reply rates.
// Removed: restaurants (high volume, low reply), chains, franchises.
const HIGH_RESPONSE_QUERIES = [
      // Tier 1 — Highest reply rate (~8-15%): owner answers phone, needs clients NOW
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
      // Tier 2 — Strong reply rate (~5-10%): professional services, budget for marketing
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
      // Tier 3 — Good reply rate (~3-7%): lifestyle services, local owner-run
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

// 55 cities — major metros + high-density secondary markets for max lead volume
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

function isTollFree(phone) {
      const digits = (phone || '').replace(/\D/g, '');
      return /^1?(800|844|855|866|877|888)/.test(digits);
}

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

async function fetchOutscraperLeads(query, limit) {
      const city = pickCity();
      const params = new URLSearchParams({
              query: query + ' in ' + city, limit, language: 'en', region: 'us',
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
              setTimeout(() => controller.abort(), 7000);
              const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (!res.ok) return null;
              const html = await res.text();
              const matches = [...new Set((html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []))];
              const junk = ['example.','sentry.','w3.org','schema.','wix','squarespace','shopify','google.','facebook.','twitter.','instagram.','.png','.jpg','.jpeg','.svg','.gif','.webp','.avif','.ico','.woff','.css','.js'];
              const clean = matches.filter(e => !junk.some(j => e.toLowerCase().includes(j))).filter(isLikelyRealEmail);
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
      const prompt = 'Write a short cold email (under 150 words) to ' + firstName + ' at ' + company + (segment === 'no_website' ? ' who has no website' : ' in the ' + industry + ' industry') + '. We are Ascend Web Development. We build ' + serviceDesc + '. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". Sign off as: Ty Smith, Owner - Ascend Web Development. No placeholders in brackets. Output only subject and body.';
      const msg = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
      const text = cleanPlaceholders(msg.content[0].text);
      const lines = text.split('\n');
      const subjectLine = lines.find(l => l.startsWith('Subject:'));
      const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question about your business';
      const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
      return { subject, body, service };
}

async function generateSms(contact, segment) {
        const company = contact.organization_name || 'your business';
        const service = pickService();
        const msgBody = `Hey! is this ${company}?`;
        return { text: msgBody, service };
}

async function generateFollowUpSms(contact, service) {
        const firstName = contact.first_name || 'there';
        const company = contact.organization_name || 'your business';
        const svc = service || pickService();
        const serviceDesc = svc === 'website'
          ? 'a website built to rank on Google and turn visitors into paying customers'
                      : svc === 'ads'
          ? 'targeted Google and Meta ad campaigns that bring paying customers straight to you'
                      : 'a custom mobile app with online booking and loyalty rewards that keeps customers coming back';
        const prompt = `Write a short, casual follow-up SMS (under 200 characters) to ${firstName} at ${company}. You are Ty Smith, owner of Ascend Web Development. We reached out a few days ago and never heard back. Do NOT ask for a call, meeting, or chat of any kind. Instead, briefly and convincingly describe the specific outcome we'd help them get: ${serviceDesc}. Be concrete and specific, not vague "grow your business" language. End with one low-pressure question inviting them to see an example or learn more - never "hop on a call" or "quick call". Do NOT include any sign-off or name — that will be added automatically. No emojis. Output ONLY the body text.`;
        const msg = await anthropic.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 120, messages: [{ role: 'user', content: prompt }] });
        const msgBody = cleanPlaceholders(msg.content[0].text.trim().replace(/^["']|["']$/g, '').trim());
        return msgBody + SMS_SIGNOFF;
}

// Mark original SMS entry as followedUp so it won't be picked up again
async function markFollowedUp(phone) {
      try {
              const smsLog = await kv.lrange('sms:log', 0, 999);
              const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
              const updated = parsed.map(e =>
                        (e.to === phone && e.type === 'sms' && !e.followedUp && e.segment !== 'auto_reply')
                                                 ? { ...e, followedUp: true }
                          : e
                                             );
              await kv.del('sms:log');
              for (const e of updated.reverse()) await kv.lpush('sms:log', JSON.stringify(e));
      } catch (e) {
              console.error('markFollowedUp error:', e.message);
      }
}

export default async function handler(req, res) {
      if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
      const auth = req.headers['authorization'];
      if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

      // Pause outbound outreach on Sundays (Mountain Time). Inbound auto-replies still run.
      const mtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' });
      if (mtDay === 'Sun') { res.status(200).json({ skipped: 'sunday', timestamp: new Date().toISOString() }); return; }

  const errors = [];
      let followupSent = 0;

  try {
          // FOLLOW-UP: leads that got an SMS 3 days ago with no reply
        try {
                  const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
                  const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
                  const allSms = await getSmsLog(500);
                  const followupCandidates = allSms.filter(s =>
                              s.type === 'sms' && !s.replied && !s.followedUp &&
                              s.segment !== 'auto_reply' &&
                              s.timestamp >= threeDaysAgo - (12 * 60 * 60 * 1000) &&
                              s.timestamp <= twoDaysAgo &&
                              s.to && !isTollFree(s.to) && !isExcludedBusiness(s.contactName) && !isExcludedPhone(s.to)
                                                                 ).slice(0, 0);
                  for (const lead of followupCandidates) {
                              try {
                                            const contactObj = { first_name: (lead.contactName || '').split(' ')[0] || 'there', organization_name: lead.contactName || '' };
                                            const followUpText = await generateFollowUpSms(contactObj, lead.service);
                                            await twilioClient.messages.create({ body: followUpText, from: TWILIO_FROM, to: lead.to });
                                            // Log the follow-up as a new SMS entry
                                await logSms({ to: lead.to, body: followUpText, contactName: lead.contactName, timestamp: Date.now(), segment: lead.segment || 'followup', service: lead.service || 'website', isFollowUp: true });
                                            // CRITICAL: Mark original entry as followedUp so it won't trigger again
                                await markFollowedUp(lead.to);
                                            followupSent++;
                              } catch (e) { errors.push({ type: 'followup_sms', error: e.message }); }
                  }
        } catch (e) { errors.push({ type: 'followup_fetch', error: e.message }); }

        // MAIN OUTREACH — rotate through high-response industries
        const hour = new Date().getUTCHours();
          const qi = Math.floor(hour / 2) % HIGH_RESPONSE_QUERIES.length;
          const [b1, b2, b3] = await Promise.all([
                    fetchOutscraperLeads(HIGH_RESPONSE_QUERIES[qi], FETCH_LIMIT),
                    fetchOutscraperLeads(HIGH_RESPONSE_QUERIES[(qi + 1) % HIGH_RESPONSE_QUERIES.length], FETCH_LIMIT),
                    fetchOutscraperLeads(HIGH_RESPONSE_QUERIES[(qi + 2) % HIGH_RESPONSE_QUERIES.length], FETCH_LIMIT)
                  ]);

        const seenPhones = new Set();
          const allLeads = [...b1, ...b2, ...b3]
            .map(normalizeContact)
            .filter(c => {
                        if (isExcludedBusiness(c.organization_name)) return false;
                        if (isExcludedPhone(c.phone)) return false;
                        if (!c.phone) return false;
                        const normalized = c.phone.replace(/\D/g, '');
                        if (seenPhones.has(normalized)) return false;
                        if (isTollFree(c.phone)) return false;
                        seenPhones.add(normalized);
                        return true;
            });

        const noWebLeads = allLeads.filter(c => hasNoWebsite(c));
          const hasWebLeads = allLeads.filter(c => !hasNoWebsite(c));

        const toScrape = hasWebLeads.slice(0, 24);
          const scraped = await Promise.all(toScrape.map(c => scrapeEmail(c.website_url)));
          toScrape.forEach((c, i) => { c.email = scraped[i] || null; });

        const leads = [...noWebLeads, ...hasWebLeads];
          const emailLeads = leads.filter(c => c.email).slice(0, EMAIL_CAP);

        // Never text a number we've already texted before, across any prior run.
        const smsCandidates = leads.slice(0, Math.max(0, SMS_CAP - followupSent) * 3);
          const smsLeads = [];
          for (const c of smsCandidates) {
                    if (smsLeads.length >= Math.max(0, SMS_CAP - followupSent)) break;
                    const normalized = (c.phone || '').replace(/\D/g, '');
                    if (!normalized) continue;
                    const alreadyContacted = await kv.sismember('sms:contacted_numbers', normalized);
                    if (alreadyContacted) continue;
                    smsLeads.push(c);
          }

        const [emailContents, smsContents] = await Promise.all([
                  Promise.all(emailLeads.map(c => generateEmail(c, hasNoWebsite(c) ? 'no_website' : 'needs_upgrade').catch(e => ({ error: e.message })))),
                  Promise.all(smsLeads.map(c => generateSms(c, hasNoWebsite(c) ? 'no_website' : 'needs_upgrade').catch(e => ({ error: e.message }))))
                ]);

        const emailResults = await Promise.all(emailLeads.map(async (contact, i) => {
                  const content = emailContents[i];
                  if (content.error) return { error: content.error };
                  try {
                              const suppressed = await isSuppressed(contact.email);
                              if (suppressed) { await logNotSent(1); return null; }
                              const { subject, body, service } = content;
                              const emailId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                                      const trackBase = 'https://final-phi-swart.vercel.app';
                                      const ctaUrl = trackBase + '/api/track-click?id=' + emailId + '&url=' + encodeURIComponent('https://ascendwebdevelopment.com');
                                      const pixel = '<img src="' + trackBase + '/api/track-open?id=' + emailId + '" width="1" height="1" style="display:none" alt="" />';
                                      const footer = '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\n<a href="' + ctaUrl + '">See examples of our work</a> | <a href="https://final-phi-swart.vercel.app/unsubscribe?email=' + encodeURIComponent(contact.email) + '">Unsubscribe</a>';
                                      const sendOptions = { from: FROM_EMAIL, to: contact.email, subject, html: (body + footer).replace(/\n/g, '<br>') + pixel, reply_to: (process.env.REPLY_TO || FROM_EMAIL) };
                                      if (i < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
                                      await sendEmail(sendOptions);
                                      await logEmail({ to: contact.email, subject, body, contactName: contact.organization_name, timestamp: Date.now(), segment: hasNoWebsite(contact) ? 'no_website' : 'needs_upgrade', service, id: emailId });
                              return 'ok';
                  } catch (e) { await logNotSent(1); return { error: e.message }; }
        }));

        const smsResults = await Promise.all(smsLeads.map(async (contact, i) => {
                  const content = smsContents[i];
                  if (content.error) return { error: content.error };
                  try {
                              const { text, service } = content;
                              await twilioClient.messages.create({ body: text, from: TWILIO_FROM, to: contact.phone });
                              await logSms({ to: contact.phone, body: text, contactName: contact.organization_name, timestamp: Date.now(), segment: hasNoWebsite(contact) ? 'no_website' : 'needs_upgrade', service });
                              const normalized = (contact.phone || '').replace(/\D/g, '');
                              if (normalized) await kv.sadd('sms:contacted_numbers', normalized);
                              return 'ok';
                  } catch (e) { return { error: e.message }; }
        }));

        const emailsSent = emailResults.filter(r => r === 'ok').length;
          const smsSent = smsResults.filter(r => r === 'ok').length;
          emailResults.filter(r => r?.error).forEach(r => errors.push({ type: 'email', error: r.error }));
          smsResults.filter(r => r?.error).forEach(r => errors.push({ type: 'sms', error: r.error }));

        res.status(200).json({ emailsSent, smsSent, followupSent, emailCap: EMAIL_CAP, smsCap: SMS_CAP, errors, timestamp: new Date().toISOString() });
  } catch (e) {
          errors.push({ type: 'fatal', error: e.message });
          res.status(200).json({ emailsSent: 0, smsSent: 0, followupSent: 0, errors, timestamp: new Date().toISOString() });
  }
}
