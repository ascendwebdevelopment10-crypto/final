import twilio from 'twilio';
import { logReply } from '../lib/store.js';
import { checkWebhookToken } from '../lib/auth.js';
import { kv } from '@vercel/kv';
import { sendEmail } from '../lib/mailer.js';

const FORWARD_TO_EMAIL = 'info@ascendwebdevelopment.com';
const NOTIFY_PHONE = '+13854716500';

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!checkWebhookToken(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
          const event = req.body;
          const type = event?.type;

      if (type === 'email.bounced' || type === 'email.complained' || type === 'email.delivery_delayed') {
              const addr = event?.data?.to?.[0] || event?.data?.email || event?.to || '';
              if (addr) {
                        await kv.sadd('suppression:emails', String(addr).toLowerCase());
                        if (type !== 'email.delivery_delayed') await kv.incr('stats:bounced');
              }
              res.status(200).json({ ok: true, suppressed: addr || null });
              return;
      }
      if (type === 'email.replied' || type === 'inbound.email' || type === 'email.received') {
              const from = event?.data?.from || event?.from || '';
              const subject = event?.data?.subject || event?.subject || '';
              const body = event?.data?.text || event?.data?.html || event?.text || event?.html || '';
              const originalTo = event?.data?.to?.[0] || event?.to || '';

            // 1. Log to dashboard
            await logReply({ from, subject, body, timestamp: Date.now(), originalTo });

            // 2. Text Ty's phone so email replies alert the same as SMS replies
            try {
                      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                      const preview = (body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
                      await client.messages.create({
                                body: 'You got a reply on Ascend Outreach!\nEmail from: ' + from + '\nSubject: ' + subject + '\n\n' + preview,
                                from: process.env.TWILIO_PHONE_NUMBER,
                                to: NOTIFY_PHONE
                      });
            } catch (e) { console.error('Email->SMS notify error:', e.message); }

            // 3. Forward to your inbox so you see it directly
            await sendEmail({
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
