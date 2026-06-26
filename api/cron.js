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

// 70 emails + 70 SMS per run x 3 runs/day = 210 emails + 210 SMS daily
const EMAIL_CAP = 70;
const SMS_CAP = 70;
// Fetch 5 per query (10 total) - 1 AI call per lead stays under 60s
const FETCH_LIMIT = 5;

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

async function fetchOutscraperLeads(query, limit = FETCH_LIMIT) {
              const params = new URLSearchParams({
                              query: `${query} in United States`,
                              limit: limit,
                              language: 'en',
                              region: 'us',
                              fields: 'name,full_address,phone,site,type,subtypes,email1,email2',
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

function normalizeContact(place) {
              return {
                              first_name: (place.name || '').split(' ')[0] || 'there',
                              organization_name: place.name || '',
                              email: place.email1 || place.email2 || null,
                              phone: place.phone || null,
                              website_url: place.site || '',
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
              const prompt = segment === 'no_website'
                ? `Write a short cold email (under 150 words) to ${firstName} at ${company} who has no website. We are Ascend Web Development. We build SEO-optimized websites + manage Google Business Profiles + run Google/Meta ads. Emphasize new customers and credibility. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`
                              : `Write a short cold email (under 150 words) to ${firstName} at ${company} in the ${industry} industry. We are Ascend Web Development and we build custom mobile apps. Mention 2-3 relevant benefits: online booking, loyalty rewards, push notifications. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`;
              const msg = await anthropic.messages.create({
                              model: ANTHROPIC_MODEL,
                              max_tokens: 350,
                              messages: [{ role: 'user', content: prompt }]
              });
              const text = msg.content[0].text;
              const lines = text.split('\n');
              const subjectLine = lines.find(l => l.startsWith('Subject:'));
              const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question about your business';
              const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
              return { subject, body };
}

async function generateSms(contact, segment) {
              const firstName = contact.first_name || 'there';
              const company = contact.organization_name || 'your business';
              const industry = contact.industry || 'your industry';
              const prompt = segment === 'no_website'
                ? `SMS under 160 chars to ${firstName} at ${company} who has no website. We are Ascend Web Development. Website = more Google traffic + credibility. CTA to reply. No emojis.`
                              : `SMS under 160 chars to ${firstName} at ${company} in ${industry}. We build custom mobile apps — booking, loyalty, push notifications. Ascend Web Development. CTA to reply. No emojis.`;
              const msg = await anthropic.messages.create({
                              model: ANTHROPIC_MODEL,
                              max_tokens: 100,
                              messages: [{ role: 'user', content: prompt }]
              });
              let smsText = msg.content[0].text.trim();
              if (smsText.length > 160) smsText = smsText.substring(0, 157) + '...';
              return smsText;
}

export default async function handler(req, res) {
              if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
              const auth = req.headers['authorization'];
              if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) { res.status(401).end('Unauthorized'); return; }

  let emailsSent = 0, smsSent = 0, errors = [];

  try {
                  // Rotate queries by UTC hour so each of the 3 daily runs hits different industries
                const hour = new Date().getUTCHours();
                  const queryIndex = Math.floor(hour / 3) % SEARCH_QUERIES.length;
                  const primaryQuery = SEARCH_QUERIES[queryIndex];
                  const secondaryQuery = SEARCH_QUERIES[(queryIndex + 1) % SEARCH_QUERIES.length];

                const [batch1, batch2] = await Promise.all([
                                  fetchOutscraperLeads(primaryQuery, FETCH_LIMIT),
                                  fetchOutscraperLeads(secondaryQuery, FETCH_LIMIT)
                                ]);

                const allLeads = [...batch1, ...batch2].map(normalizeContact);
                  // Only keep leads that have email OR phone - skip leads with neither
                const usableLeads = allLeads.filter(c => c.email || c.phone);
                  const noWebLeads = usableLeads.filter(c => hasNoWebsite(c));
                  const appLeads = usableLeads.filter(c => !hasNoWebsite(c));
                  const leads = [...noWebLeads, ...appLeads];

                for (const contact of leads) {
                                  if (emailsSent >= EMAIL_CAP && smsSent >= SMS_CAP) break;
                                  const segment = hasNoWebsite(contact) ? 'no_website' : 'needs_app';

                    if (contact.email && emailsSent < EMAIL_CAP) {
                                        try {
                                                              const suppressed = await isSuppressed(contact.email);
                                                              if (!suppressed) {
                                                                                      const { subject, body } = await generateEmail(contact, segment);
                                                                                      const footer = `\n\n--\nAscend Web Development\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(contact.email)}">Unsubscribe</a>`;
                                                                                      const sendOptions = {
                                                                                                                from: FROM_EMAIL, to: contact.email, subject,
                                                                                                                html: (body + footer).replace(/\n/g, '<br>'),
                                                                                                                reply_to: FROM_EMAIL
                                                                                                  };
                                                                                      if (emailsSent < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
                                                                                      await resend.emails.send(sendOptions);
                                                                                      await logEmail({ to: contact.email, subject, contactName: contact.organization_name, timestamp: Date.now(), segment });
                                                                                      emailsSent++;
                                                              }
                                        } catch (e) { errors.push({ type: 'email', to: contact.email, error: e.message }); }
                    }

                    if (contact.phone && smsSent < SMS_CAP) {
                                        try {
                                                              const smsBody = await generateSms(contact, segment);
                                                              await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: contact.phone });
                                                              await logSms({ to: contact.phone, body: smsBody, contactName: contact.organization_name, timestamp: Date.now(), segment });
                                                              smsSent++;
                                        } catch (e) { errors.push({ type: 'sms', to: contact.phone, error: e.message }); }
                    }
                }
  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({ emailsSent, smsSent, emailCap: EMAIL_CAP, smsCap: SMS_CAP, errors, timestamp: new Date().toISOString() });
}
