import { Resend } from 'resend';
import { logReply } from '../lib/store.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FORWARD_TO_EMAIL = 'info@ascendwebdevelopment.com';

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    try {
          const event = req.body;
          const type = event?.type;

      if (type === 'email.replied' || type === 'inbound.email') {
              const from = event?.data?.from || event?.from || '';
              const subject = event?.data?.subject || event?.subject || '';
              const body = event?.data?.text || event?.data?.html || event?.text || event?.html || '';
              const originalTo = event?.data?.to?.[0] || event?.to || '';

            // 1. Log to dashboard
            await logReply({ from, subject, body, timestamp: Date.now(), originalTo });

            // 2. Forward to your inbox so you see it directly
            await resend.emails.send({
                      from: 'info@ascendwebdevelopment.com',
                      to: [FORWARD_TO_EMAIL, 'tysmith327@icloud.com'],
                      subject: 'Reply: ' + subject,
                      html: '<p><strong>From:</strong> ' + from + '</p><p><strong>Subject:</strong> ' + subject + '</p><hr/>' + body,
                      reply_to: from
            });
      }

      res.status(200).json({ ok: true });
    } catch (e) {
          console.error('Webhook error:', e.message);
          res.status(200).json({ ok: true });
    }
}
