import twilio from 'twilio';
import { kv } from '@vercel/kv';
import { isExcludedPhone, isExcludedBusiness } from '../lib/store.js';

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET;
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

// Sends any scheduled reply (from api/sms-webhook.js) whose 3-minute delay has elapsed.
// Runs on a frequent cron (see vercel.json) so replies go out roughly on time.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
    const auth = req.headers['authorization'];
      if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

        let sent = 0;
          const errors = [];
            let remaining = 0;

              try {
                  const raw = await kv.lrange('sms:pending_replies', 0, 499);
                      const parsed = raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
                          const now = Date.now();
                              const due = parsed.filter(p => p.sendAt <= now);
                                  const notYetDue = parsed.filter(p => p.sendAt > now);
                                      remaining = notYetDue.length;

                                          for (const p of due) {
      if (isExcludedPhone(p.to) || isExcludedBusiness(p.contactName)) { continue; }
                                                try {
                                                        await twilioClient.messages.create({ body: p.body, from: TWILIO_FROM, to: p.to });
                                                                await kv.lpush('sms:log', JSON.stringify({
                                                                          type: 'sms',
                                                                                    to: p.to,
                                                                                              body: p.body,
                                                                                                        contactName: p.contactName || '',
                                                                                                                  timestamp: Date.now(),
                                                                                                                            segment: 'auto_reply',
                                                                                                                                      service: 'general',
                                                                                                                                                replied: false
                                                                                                                                                        }));
                                                                                                                                                                sent++;
                                                                                                                                                                      } catch (e) {
                                                                                                                                                                              errors.push({ to: p.to, error: e.message });
                                                                                                                                                                                      // Keep it queued so we retry on the next run instead of losing it
                                                                                                                                                                                              notYetDue.push(p);
                                                                                                                                                                                                      remaining++;
                                                                                                                                                                                                            }
                                                                                                                                                                                                                }
                                                                                                                                                                                                                
                                                                                                                                                                                                                    // Rebuild the pending list with only the ones still waiting (or that failed to send)
                                                                                                                                                                                                                        await kv.del('sms:pending_replies');
                                                                                                                                                                                                                            for (const p of notYetDue.reverse()) await kv.rpush('sms:pending_replies', JSON.stringify(p));
                                                                                                                                                                                                                              } catch (e) {
                                                                                                                                                                                                                                  errors.push({ type: 'fatal', error: e.message });
                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                      res.status(200).json({ sent, remaining, errors, timestamp: new Date().toISOString() });
                                                                                                                                                                                                                                      }
