import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import twilio from 'twilio';
import { logEmail, logSms, isSuppressed } from '../lib/store.js';

export const config = { maxDuration: 300 };

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;

// Fixed daily caps: 200 emails + 200 SMS = 400 outreaches/day
const EMAIL_DAILY_CAP = 200;
const SMS_DAILY_CAP = 200;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const BCC_PREVIEW_EMAIL = 'info@ascendwebdevelopment.com';
const BCC_PREVIEW_LIMIT = 10;

const SEARCH_QUERIES = [
      'restaurant',
      'gym fitness yoga',
      'salon barbershop spa',
      'real estate agent',
      'landscaping lawn care',
      'plumbing hvac electrical',
      'roofing cleaning pest control',
      'dental chiropractic healthcare',
      'auto repair mechanic',
      'childcare daycare tutoring',
      'photography event planning catering',
      'moving delivery courier',
      'church nonprofit organization'
    ];

// Fetch leads from Outscraper Google Maps API
async function fetchOutscraperLeads(query, limit = 20) {
      const params = new URLSearchParams({
              query: `${query} in United States`,
              limit: limit,
              language: 'en',
              region: 'us',
              fields: 'name,full_address,phone,site,type,subtypes,email1,email2',
              async: 'false'
      });

  const res = await fetch(`https://api.app.outscraper.com/maps/search-v3?${params}`, {
          method: 'GET',
          headers: {
                    'X-API-KEY': OUTSCRAPER_API_KEY
          }
  });

  if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Outscraper error: ${res.status} - ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
      // Outscraper returns { data: [[...results]] }
  const results = data?.data?.[0] || [];
      return results;
}

// Normalize Outscraper contact to match our processing format
function normalizeContact(place) {
      return {
              first_name: (place.name || '').split(' ')[0] || 'there',
              organization_name: place.name || '',
              email: place.email1 || place.email2 || null,
              phone: place.phone || null,
              website_url: place.site || '',
              industry: place.type || place.subtypes || '',
              title: 'owner',
              full_address: place.full_address || ''
      };
}

function hasNoWebsite(contact) {
      return !contact.website_url || contact.website_url.trim() === '';
}

async function generateEmail(contact, segment) {
      const firstName = contact.first_name || 'there';
      const company = contact.organization_name || 'your business';
      const industry = contact.industry || 'your industry';
      let prompt;
      if (segment === 'no_website') {
              prompt = `Write a short personalized cold email (under 150 words) to ${firstName}, owner at ${company}. They currently have no website. We are Ascend Web Development. We build SEO-optimized websites that help local businesses get found on Google, plus we manage Google Business Profiles and run Google/Meta ads. Emphasize the credibility and new customer flow a website brings. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`;
      } else {
              prompt = `Write a short personalized cold email (under 150 words) to ${firstName}, owner at ${company} in the ${industry} industry. We are Ascend Web Development and we build custom mobile apps for businesses like theirs. For ${industry} businesses specifically, a custom app can enable: online booking/scheduling, loyalty rewards, push notifications for deals, and direct customer communication. Pick 2-3 most relevant benefits for this industry and mention them specifically. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`;
      }
      const msg = await anthropic.messages.create({
              model: 'claude-3-haiku-20240307',
              max_tokens: 400,
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
      let prompt;
      if (segment === 'no_website') {
              prompt = `SMS (under 160 chars) to ${firstName} at ${company} who has no website. We are Ascend Web Development. Getting a website = more Google traffic + credibility. CTA to reply. No emojis. Max 160 chars.`;
      } else {
              prompt = `SMS (under 160 chars) to ${firstName} at ${company} in ${industry}. We build custom mobile apps — booking, loyalty, push notifications. We are Ascend Web Development. CTA to reply. No emojis. Max 160 chars.`;
      }
      const msg = await anthropic.messages.create({
              model: 'claude-3-haiku-20240307',
              max_tokens: 160,
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

  async function processContacts(contacts, segment) {
          for (const raw of contacts) {
                    if (emailsSent >= EMAIL_DAILY_CAP && smsSent >= SMS_DAILY_CAP) break;
                    const contact = normalizeContact(raw);
                    const email = contact.email;
                    const phone = contact.phone;

            if (email && emailsSent < EMAIL_DAILY_CAP) {
                        try {
                                      const suppressed = await isSuppressed(email);
                                      if (!suppressed) {
                                                      const { subject, body } = await generateEmail(contact, segment);
                                                      const footer = `\n\n--\nAscend Web Development\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(email)}">Unsubscribe</a>`;
                                                      const sendOptions = {
                                                                        from: FROM_EMAIL,
                                                                        to: email,
                                                                        subject,
                                                                        html: (body + footer).replace(/\n/g, '<br>'),
                                                                        reply_to: FROM_EMAIL
                                                      };
                                                      if (emailsSent < BCC_PREVIEW_LIMIT) sendOptions.bcc = BCC_PREVIEW_EMAIL;
                                                      await resend.emails.send(sendOptions);
                                                      await logEmail({ to: email, subject, contactName: contact.organization_name, timestamp: Date.now(), segment });
                                                      emailsSent++;
                                      }
                        } catch (e) { errors.push({ type: 'email', segment, to: email, error: e.message }); }
            }

            if (phone && smsSent < SMS_DAILY_CAP) {
                        try {
                                      const smsBody = await generateSms(contact, segment);
                                      await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: phone });
                                      await logSms({ to: phone, body: smsBody, contactName: contact.organization_name, timestamp: Date.now(), segment });
                                      smsSent++;
                        } catch (e) { errors.push({ type: 'sms', segment, to: phone, error: e.message }); }
            }
          }
  }

  try {
          // Rotate through search queries to get varied leads each day
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
          const queryIndex = dayOfYear % SEARCH_QUERIES.length;
          const primaryQuery = SEARCH_QUERIES[queryIndex];
          const secondaryQuery = SEARCH_QUERIES[(queryIndex + 1) % SEARCH_QUERIES.length];

        // Fetch ~220 leads across two queries (110 each) to ensure we hit 200 emails + 200 SMS
        const [batch1, batch2] = await Promise.all([
                  fetchOutscraperLeads(primaryQuery, 110),
                  fetchOutscraperLeads(secondaryQuery, 110)
                ]);

        const allLeads = [...batch1, ...batch2];

        // Split: no_website segment first, then needs_app
        const noWebLeads = allLeads.filter(c => hasNoWebsite(normalizeContact(c)));
          const appLeads = allLeads.filter(c => !hasNoWebsite(normalizeContact(c)));

        await processContacts(noWebLeads, 'no_website');
          await processContacts(appLeads, 'needs_app');

  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({
          emailsSent,
          smsSent,
          emailCap: EMAIL_DAILY_CAP,
          smsCap: SMS_DAILY_CAP,
          errors,
          timestamp: new Date().toISOString()
  });
}
