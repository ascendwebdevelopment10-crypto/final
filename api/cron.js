import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import twilio from 'twilio';
import { logEmail, logSms, isSuppressed } from '../lib/store.js';

// Node.js runtime (required for twilio, resend, anthropic)
export const config = { maxDuration: 300 };

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@ascendwebdevelopment.com';
const DAILY_CAP = parseInt(process.env.DAILY_CAP || '500');
const SMS_DAILY_CAP = parseInt(process.env.SMS_DAILY_CAP || '500');
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';
const PITCH = process.env.OUTREACH_PITCH || 'we offer seo optimized websites, manage google business profile, run google/meta ads, create customized mobile apps';
const TARGET_TITLES = process.env.TARGET_TITLES || 'CEO,Owner,Founder,President';
const TARGET_KEYWORDS = process.env.TARGET_KEYWORDS || 'service based businesses';
const TARGET_LOCATIONS = process.env.TARGET_LOCATIONS || 'United States';
const CRON_SECRET = process.env.CRON_SECRET;

const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

async function fetchContacts(page = 1) {
  const body = {
    api_key: APOLLO_API_KEY,
    q_keywords: TARGET_KEYWORDS,
    person_titles: TARGET_TITLES.split(',').map(t => t.trim()),
    person_locations: [TARGET_LOCATIONS],
    contact_email_status: ['verified', 'likely to engage'],
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

async function generateEmail(contact) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your company';
  const title = contact.title || 'business owner';
  const msg = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a short, personalized cold outreach email (under 150 words) to ${firstName}, who is a ${title} at ${company}. We are Ascend Web Development. ${PITCH}. Be friendly, conversational, no fluff. End with a soft CTA to reply if interested. Subject line on first line starting with "Subject:". Do not use placeholders.`
    }]
  });
  const text = msg.content[0].text;
  const lines = text.split('\n');
  const subjectLine = lines.find(l => l.startsWith('Subject:'));
  const subject = subjectLine ? subjectLine.replace('Subject:', '').trim() : 'Quick question';
  const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
  return { subject, body };
}

async function generateSms(contact) {
  const firstName = contact.first_name || 'there';
  const company = contact.organization_name || 'your company';
  const msg = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 160,
    messages: [{
      role: 'user',
      content: `Write a short SMS outreach message (under 160 chars) to ${firstName} at ${company}. We are Ascend Web Development. ${PITCH}. Friendly, direct, one sentence CTA. No emojis. Must be under 160 characters total.`
    }]
  });
  let smsText = msg.content[0].text.trim();
  if (smsText.length > 160) smsText = smsText.substring(0, 157) + '...';
  return smsText;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    res.status(401).end('Unauthorized'); return;
  }

  let emailsSent = 0, smsSent = 0, errors = [];
  let page = 1;

  try {
    while (emailsSent < DAILY_CAP || smsSent < SMS_DAILY_CAP) {
      const data = await fetchContacts(page++);
      const contacts = data.people || data.contacts || [];
      if (!contacts.length) break;

      for (const contact of contacts) {
        if (emailsSent >= DAILY_CAP && smsSent >= SMS_DAILY_CAP) break;
        const email = contact.email;
        const phone = contact.phone_numbers?.[0]?.sanitized_number || contact.mobile_phone;

        if (email && emailsSent < DAILY_CAP) {
          try {
            const suppressed = await isSuppressed(email);
            if (!suppressed) {
              const { subject, body } = await generateEmail(contact);
              const emailBody = body + `\n\n--\n${PHYSICAL_ADDRESS}\n<a href="https://final-phi-swart.vercel.app/unsubscribe?email=${encodeURIComponent(email)}">Unsubscribe</a>`;
              await resend.emails.send({ from: FROM_EMAIL, to: email, subject, html: emailBody.replace(/\n/g, '<br>') });
              await logEmail({ to: email, subject, contactId: contact.id, timestamp: Date.now() });
              emailsSent++;
            }
          } catch (e) { errors.push({ type: 'email', to: email, error: e.message }); }
        }

        if (phone && smsSent < SMS_DAILY_CAP) {
          try {
            const smsBody = await generateSms(contact);
            await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: phone });
            await logSms({ to: phone, body: smsBody, contactId: contact.id, timestamp: Date.now() });
            smsSent++;
          } catch (e) { errors.push({ type: 'sms', to: phone, error: e.message }); }
        }
      }
      if (page > 20) break;
    }
  } catch (e) { errors.push({ type: 'fatal', error: e.message }); }

  res.status(200).json({ emailsSent, smsSent, errors, timestamp: new Date().toISOString() });
}
