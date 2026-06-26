import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import twilio from 'twilio';
import { logEmail, logSms, isSuppressed } from '../lib/store.js';

export const config = { maxDuration: 300 };

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const DAILY_CAP = parseInt(process.env.DAILY_CAP || '500');
const SMS_DAILY_CAP = parseInt(process.env.SMS_DAILY_CAP || '500');
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const CRON_SECRET = process.env.CRON_SECRET;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

// Industries that strongly benefit from a mobile app
const APP_INDUSTRIES = [
  'restaurant','food','cafe','bar','gym','fitness','yoga','personal training',
  'salon','barbershop','spa','nail','beauty','massage',
  'real estate','property management','landscaping','lawn care',
  'plumbing','hvac','electrical','roofing','cleaning','pest control',
  'childcare','daycare','tutoring','healthcare','dental','chiropractic',
  'auto repair','mechanic','towing','delivery','moving',
  'photography','event planning','catering','church','nonprofit'
];

function needsApp(contact) {
  const combined = [
    contact.organization?.industry || '',
    contact.industry || '',
    contact.organization_name || '',
    contact.title || ''
  ].join(' ').toLowerCase();
  return APP_INDUSTRIES.some(kw => combined.includes(kw));
}

function hasNoWebsite(contact) {
  const website = contact.organization?.website_url || contact.website_url || '';
  return !website || website.trim() === '';
}

async function fetchContacts(keywords, page = 1) {
  const body = {
    api_key: APOLLO_API_KEY,
    q_keywords: keywords,
    person_titles: ['owner', 'CEO', 'founder', 'president', 'manager', 'operator'],
    person_locations: ['United States'],
    contact_email_status: ['verified', 'likely to engage'],
    organization_num_employees_ranges: ['1,10', '1,50'],
    per_page: 25,
    page
  };
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Apollo error: ' + res.status);
  return res.json();
}

async function generateEmail(contact, segment) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your business';
  const title = contact.title || 'business owner';
  const industry = contact.organization?.industry || contact.industry || 'your industry';

  let prompt;
  if (segment === 'no_website') {
    prompt = `Write a short personalized cold email (under 150 words) to ${firstName}, ${title} at ${company}. They currently have no website. We are Ascend Web Development. We build SEO-optimized websites that help local businesses get found on Google, plus we manage Google Business Profiles and run Google/Meta ads. Emphasize the credibility and new customer flow a website brings. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`;
  } else {
    prompt = `Write a short personalized cold email (under 150 words) to ${firstName}, ${title} at ${company} in the ${industry} industry. We are Ascend Web Development and we build custom mobile apps for businesses like theirs. For ${industry} businesses specifically, a custom app can enable: online booking/scheduling, loyalty rewards, push notifications for deals, and direct customer communication. Pick 2-3 most relevant benefits for this industry and mention them specifically. Friendly, no fluff. Soft CTA to reply. Subject line first as "Subject: ...". No placeholders.`;
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
  const industry = contact.organization?.industry || contact.industry || 'your industry';

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
    for (const contact of contacts) {
      if (emailsSent >= DAILY_CAP && smsSent >= SMS_DAILY_CAP) break;
      const email = contact.email;
      const phone = contact.phone_numbers?.[0]?.sanitized_number || contact.mobile_phone;

      if (email && emailsSent < DAILY_CAP) {
        try {
          const suppressed = await isSuppressed(email);
          if (!suppressed) {
            const { subject, body } = await generateEmail(contact, segment);
            const footer = `\n\n--\nAscend Web Development\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(email)}">Unsubscribe</a>`;
            await resend.emails.send({ from: FROM_EMAIL, to: email, subject, html: (body + footer).replace(/\n/g, '<br>') });
            await logEmail({ to: email, subject, contactId: contact.id, timestamp: Date.now(), segment });
            emailsSent++;
          }
        } catch (e) { errors.push({ type: 'email', segment, to: email, error: e.message }); }
      }

      if (phone && smsSent < SMS_DAILY_CAP) {
        try {
          const smsBody = await generateSms(contact, segment);
          await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: phone });
          await logSms({ to: phone, body: smsBody, contactId: contact.id, timestamp: Date.now(), segment });
          smsSent++;
        } catch (e) { errors.push({ type: 'sms', segment, to: phone, error: e.message }); }
      }
    }
  }

  try {
    const halfCap = Math.floor(DAILY_CAP / 2);
    const halfSmsCap = Math.floor(SMS_DAILY_CAP / 2);

    // Segment 1: No website (250 emails + 250 SMS)
    const noWebContacts = [];
    for (let page = 1; page <= 12 && noWebContacts.length < halfCap + 50; page++) {
      const data = await fetchContacts('local service business small company', page);
      const contacts = data.people || data.contacts || [];
      if (!contacts.length) break;
      noWebContacts.push(...contacts.filter(c => hasNoWebsite(c)));
    }
    await processContacts(noWebContacts.slice(0, halfCap + 50), 'no_website');

    // Segment 2: App-ready industries (remaining cap)
    const remaining = DAILY_CAP - emailsSent;
    const appContacts = [];
    for (let page = 1; page <= 12 && appContacts.length < remaining + 50; page++) {
      const data = await fetchContacts('restaurant gym salon real estate landscaping plumbing fitness spa dental auto repair', page);
      const contacts = data.people || data.contacts || [];
      if (!contacts.length) break;
      appContacts.push(...contacts.filter(c => needsApp(c)));
    }
    await processContacts(appContacts, 'needs_app');

  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({ emailsSent, smsSent, errors, timestamp: new Date().toISOString() });
}
