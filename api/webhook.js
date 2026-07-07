import { sendEmail, FROM_EMAIL } from '../lib/mailer.js';
import { logReply } from '../lib/store.js';

const FORWARD_TO_EMAIL = 'info@ascendwebdevelopment.com';

// Push notification via ntfy.sh — instant alert on your phone when an email reply comes in.
// Mirrors the same push used for SMS replies in sms-webhook.js, so both channels notify.
async function sendPushNotification(from, subject, body) {
          try {
                      const topic = process.env.NTFY_TOPIC || 'ascend-replies';
                      const title = `Email reply from ${from}`;
                      const message = (subject ? subject + ' — ' : '') + String(body || '').replace(/<[^>]*>/g, '').slice(0, 200);
                      await fetch(`https://ntfy.sh/${topic}`, {
                                    method: 'POST',
                                    headers: {
                                                    'Title': title,
                                                    'Priority': 'high',
                                                    'Tags': 'email,speech_balloon',
                                                    'Content-Type': 'text/plain'
                                    },
                                    body: message
                      });
          } catch (e) {
                      console.error('ntfy push error:', e.message);
          }
}

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

                                // 2. Push notification to phone — fires for every real email reply
                                await sendPushNotification(from, subject, body);

                                // 3. Forward to your inbox so you see it directly
                                await sendEmail({
                                                              from: FROM_EMAIL,
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
