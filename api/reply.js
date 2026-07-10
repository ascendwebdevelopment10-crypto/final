import twilio from 'twilio';
import { sendEmail, FROM_EMAIL } from '../lib/mailer.js';
import { kv } from '@vercel/kv';
import { isExcludedPhone } from '../lib/store.js';

export default async function handler(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(200).end(); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { type, to, message, subject, key } = req.body || {};

    // Auth check
    if (key !== process.env.CRON_SECRET && key !== process.env.SUPPRESS_API_SECRET) {
                  res.status(401).json({ error: 'Unauthorized' }); return;
    }

    if (!type || !to || !message) {
                  res.status(400).json({ error: 'Missing type, to, or message' }); return;
    }

    try {
                  if (type === 'sms') {
                    if (isExcludedPhone(to)) { res.status(200).json({ ok: false, skipped: 'excluded_contact' }); return; }
                                        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                                        const sent = await client.messages.create({
                                                                        body: message,
                                                                        from: process.env.TWILIO_PHONE_NUMBER,
                                                                        to: to.startsWith('+') ? to : '+1' + to.replace(/\D/g, '')
                                        });

                          // Log outbound reply
                          const entry = {
                                                          type: 'sms_reply_out',
                                                          to,
                                                          body: message,
                                                          sid: sent.sid,
                                                          timestamp: Date.now(),
                                                          id: Date.now() + '-' + Math.random().toString(36).slice(2, 8)
                          };
                                        await kv.lpush('replies:log', JSON.stringify(entry));

                          res.status(200).json({ ok: true, sid: sent.sid });

                  } else if (type === 'email') {
                                        const result = await sendEmail({
                                                                        from: 'Ascend Web Development <' + FROM_EMAIL + '>',
                                                                        to: [to],
                                                                        subject: subject || 'Re: Your inquiry',
                                                                        text: message,
                                                                        html: '<p>' + message.replace(/\n/g, '<br>') + '</p>'
                                        });

                          // Log outbound reply
                          const entry = {
                                                          type: 'email_reply_out',
                                                          to,
                                                          subject: subject || 'Re: Your inquiry',
                                                          body: message,
                                                          id: result?.messageId || (Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
                                                          timestamp: Date.now()
                          };
                                        await kv.lpush('replies:log', JSON.stringify(entry));

                          res.status(200).json({ ok: true, id: result?.messageId });

                  } else {
                                        res.status(400).json({ error: 'type must be sms or email' });
                  }
    } catch (e) {
                  console.error('Reply error:', e.message);
                  res.status(500).json({ error: e.message });
    }
}
