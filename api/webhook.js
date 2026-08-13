import { Resend } from 'resend';
import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { addToSuppression, logReply, recordEmailEvent } from '../lib/store.js';
import { notifyBestEffort } from '../lib/ntfy.js';

const FORWARD_TO_EMAIL = 'nitrooutreach@outlook.com';
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function decodeSecret(value) {
  const raw = String(value || '').replace(/^whsec_/, '');
  try { return Buffer.from(raw, 'base64'); } catch { return Buffer.alloc(0); }
}

export function validWebhookSignature(payload, req, secret) {
  const id = String(req.headers['svix-id'] || '');
  const timestamp = String(req.headers['svix-timestamp'] || '');
  const supplied = String(req.headers['svix-signature'] || '');
  if (!id || !timestamp || !supplied || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const key = decodeSecret(secret);
  if (!key.length) return false;
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest();
  return supplied.split(' ').some(part => {
    const encoded = part.startsWith('v1,') ? part.slice(3) : '';
    if (!encoded) return false;
    try {
      const received = Buffer.from(encoded, 'base64');
      return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    } catch { return false; }
  });
}

function address(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

async function receivedEmail(emailId) {
  if (!emailId || !process.env.RESEND_API_KEY) return null;
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!response.ok) return null;
  return response.json();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    try {
          const payload = await rawBody(req);
          const secret = process.env.RESEND_WEBHOOK_SECRET || await kv.get('outreach:resend:webhook-secret');
          if (!validWebhookSignature(payload, req, secret)) { res.status(401).json({ error: 'Invalid webhook signature' }); return; }
          const event = JSON.parse(payload);
          const resend = new Resend(process.env.RESEND_API_KEY);
          const type = event?.type;

      const data = event?.data || {};
      const providerId = data.email_id || data.id || event?.email_id || '';

      if (['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.suppressed'].includes(type)) {
              const recipient = Array.isArray(data.to) ? data.to[0] : data.to;
              const detail = data.error || data.reason || data.bounce?.message || '';
              await recordEmailEvent({ providerId, to: recipient, status: type, timestamp: Date.parse(event.created_at || data.created_at) || Date.now(), detail });
              if (['email.bounced', 'email.complained', 'email.suppressed'].includes(type) && recipient) {
                    await addToSuppression(address(recipient));
              }
      }

      if (type === 'email.received' || type === 'email.replied' || type === 'inbound.email') {
              const complete = type === 'email.received' ? await receivedEmail(providerId) : null;
              const from = complete?.from || data.from || event?.from || '';
              const subject = complete?.subject || data.subject || event?.subject || '';
              const body = complete?.text || complete?.html || data.text || data.html || event?.text || event?.html || '';
              const originalTo = complete?.to?.[0] || data.to?.[0] || event?.to || '';

            // 1. Log to dashboard
            const added = await logReply({ from, subject, body, timestamp: Date.parse(event.created_at || complete?.created_at) || Date.now(), originalTo, thread: complete?.message_id || data.message_id, eventId: providerId || event?.id });
            if (added) await notifyBestEffort({ title: `New outreach reply: ${subject || 'No subject'}`, message: `${from}: ${String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`, priority: 'high', tags: 'incoming_envelope,email', click: 'https://nitrooutreach.com/dashboard#outreach' });

            // 2. Forward to your inbox so you see it directly
            if (added) await resend.emails.send({
                      from: 'Nitro Outreach <hello@nitrooutreach.com>',
                      to: [FORWARD_TO_EMAIL, 'tysmith327@icloud.com'],
                      subject: 'Reply: ' + subject,
                      html: '<p><strong>From:</strong> ' + from + '</p><p><strong>Subject:</strong> ' + subject + '</p><hr/>' + (complete?.html || body),
                      reply_to: from
            });
      }

      res.status(200).json({ ok: true });
    } catch (e) {
          console.error('Webhook error:', e.message);
          res.status(200).json({ ok: true });
    }
}
