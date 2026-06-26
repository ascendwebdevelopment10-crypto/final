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

// Businesses that strongly benefit from a mobile app
const APP_INDUSTRIES = [
  'restaurant', 'food', 'cafe', 'bar', 'gym', 'fitness', 'yoga', 'personal training',
  'salon', 'barbershop', 'spa', 'nail', 'beauty', 'massage',
  'real estate', 'property management', 'landscaping', 'lawn care',
  'plumbing', 'hvac', 'electrical', 'roofing', 'cleaning', 'pest control',
  'childcare', 'daycare', 'tutoring', 'healthcare', 'dental', 'chiropractic',
  'auto repair', 'mechanic', 'towing', 'delivery', 'moving',
  'photography', 'event planning', 'catering', 'church', 'nonprofit'
];

function needsApp(contact) {
  const industry = (contact.organization?.industry || contact.industry || '').toLowerCase();
  const title = (contact.title || '').toLowerCase();
  const company = (contact.organization_name || '').toLowerCase();
  const combined = industry + ' ' + company + ' ' + title;
  return APP_INDUSTRIES.some(kw => combined.includes(kw));
}

function hasNoWebsite(contact) {
  const website = contact.organization?.website_url || contact.website_url || '';
  return !website || website.trim() === '';
}

// Fetch contacts with no website
async function fetchNoWebsiteContacts(page = 1) {
  const body = {
    api_key: APOLLO_API_KEY,
    q_keywords: 'service business local',
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

// Fetch contacts in app-friendly industries
async function fetchAppIndustryContacts(page = 1) {
  const body = {
    api_key: APOLLO_API_KEY,
    q_keywords: 'restaurant gym salon real estate landscaping plumbing fitness spa',
    person_titles: ['owner', 'CEO', 'founder', 'president', 'manager'],
    person_locations: ['United States'],
    contact_email_status: ['verified', 'likely to engage'],
    organization_num_employees_ranges: ['1,50'],
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

  let prompt;
  if (segment === 'no_website') {
    prompt = `Write a short, friendly cold email (under 150 words) to ${firstName}, ${title} at ${company}. They appear to not have a website yet. We are Ascend Web Development and we build SEO-optimized websites, manage Google Business profiles, and run Google/Meta ads for local service businesses. Highlight how a professional website helps them get found on Google and look credible to customers. Soft CTA to reply if interested. Subject line first starting with "Subject:". No placeholders.`;
  } else if (segment === 'needs_app') {
    prompt = `Write a short, friendly cold email (under 150 words) to ${firstName}, ${title} at ${company}. We are Ascend Web Development and we build custom mobile apps for service businesses. For a ${title} in their industry, an app can handle scheduling, loyalty programs, push notifications, and customer retention. Mention a specific use case relevant to their type of business. Soft CTA to reply if interested. Subject line first starting with "Subject:". No placeholders.`;
  } else {
    prompt = `Write a short, friendly cold email (under 150 words) to ${firstName}, ${title} at ${company}. We are Ascend Web Development. We build SEO-optimized websites, manage Google Business profiles, run Google/Meta ads, and create custom mobile apps for service businesses. Soft CTA to reply if interested. Subject line first starting with "Subject:". No placeholders.`;
  }

  const msg = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = msg.content[0].text;
  const lines = text.split('\n');
  const subjectLine = lines.find(l => l.startsWith('Subject:'));
  const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question';
  const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
  return { subject, body };
}

async function generateSms(contact, segment) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your business';

  let prompt;
  if (segment === 'no_website') {
    prompt = `Write an SMS (under 160 chars) to ${firstName} at ${company} who has no website. We are Ascend Web Development. Mention we build websites that get found on Google. Direct, friendly, one CTA. No emojis. Under 160 chars.`;
  } else if (segment === 'needs_app') {
    prompt = `Write an SMS (under 160 chars) to ${firstName} at ${company}. We build custom mobile apps for businesses like theirs — scheduling, loyalty, push notifications. We are Ascend Web Development. Direct CTA. No emojis. Under 160 chars.`;
  } else {
    prompt = `Write an SMS (under 160 chars) to ${firstName} at ${company}. We are Ascend Web Development — websites, Google ads, mobile apps for service businesses. Direct CTA to reply. No emojis. Under 160 chars.`;
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
  const halfCap = Math.floor(DAILY_CAP / 2);
  const halfSmsCap = Math.floor(SMS_DAILY_CAP / 2);

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
            const emailBody = body + `\n\n--\nAscend Web Development\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(email)}">Unsubscribe</a>`;
            await resend.emails.send({ from: FROM_EMAIL, to: email, subject, html: emailBody.replace(/\n/g, '<br>') });
            const { logEmail } = await import('../lib/store.js');
            await logEmail({ to: email, subject, contactId: contact.id, timestamp: Date.now(), segment });
            emailsSent++;
          }
        } catch (e) { errors.push({ type: 'email', segment, to: email, error: e.message }); }
      }

      if (phone && smsSent < SMS_DAILY_CAP) {
        try {
          const smsBody = await generateSms(contact, segment);
          await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: phone });
          const { logSms } = await import('../lib/store.js');
          await logSms({ to: phone, body: smsBody, contactId: contact.id, timestamp: Date.now(), segment });
          smsSent++;
        } catch (e) { errors.push({ type: 'sms', segment, to: phone, error: e.message }); }
      }
    }
  }

  try {
    // Run two segments in sequence, each gets half the cap
    let page = 1;
    const noWebContacts = [];
    while (noWebContacts.length < halfCap && page <= 10) {
      const data = await fetchNoWebsiteContacts(page++);
      const contacts = data.people || data.contacts || [];
      if (!contacts.length) break;
      noWebContacts.push(...contacts.filter(c => hasNoWebsite(c)));
    }
    await processContacts(noWebContacts.slice(0, halfCap), 'no_website');

    page = 1;
    const appContacts = [];
    while (appContacts.length < (DAILY_CAP - emailsSent) + 10 && page <= 10) {
      const data = await fetchAppIndustryContacts(page++);
      const contacts = data.people || data.contacts || [];
      if (!contacts.length) break;
      appContacts.push(...contacts.filter(c => needsApp(c)));
    }
    await processContacts(appContacts, 'needs_app');

    // If still under cap, fill with general contacts
    if (emailsSent < DAILY_CAP || smsSent < SMS_DAILY_CAP) {
      page = 1;
      while ((emailsSent < DAILY_CAP || smsSent < SMS_DAILY_CAP) && page <= 5) {
        const data = await fetchNoWebsiteContacts(page++);
        const contacts = data.people || data.contacts || [];
        if (!contacts.length) break;
        await processContacts(contacts, 'general');
      }
    }
  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({ emailsSent, smsSent, errors, timestamp: new Date().toISOString() });
}
