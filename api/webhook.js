import { Resend } from 'resend';
import { addToSuppression, logReply, recordEmailEvent } from '../lib/store.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FORWARD_TO_EMAIL = 'nitrooutreach@outlook.com';

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
          const event = req.body;
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
