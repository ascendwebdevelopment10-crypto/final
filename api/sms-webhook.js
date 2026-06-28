import twilio from 'twilio';
import { kv } from '@vercel/kv';

const FORWARD_TO = '+13854716500';

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).end(); return; }

  const from = req.body?.From || '';
    const body = req.body?.Body || '';
    const to = req.body?.To || '';

  // 1. Forward to your phone FIRST before anything else can fail
  try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
                body: 'Reply from ' + from + ':\n' + body,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: FORWARD_TO
        });
  } catch (e) {
        console.error('Twilio forward error:', e.message);
  }

  // 2. Log to dashboard
  try {
        const entry = {
                type: 'sms_reply', from, body, to,
                timestamp: Date.now(),
                id: Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        };
        await kv.lpush('replies:log', JSON.stringify(entry));
        await kv.incr('stats:sms_replies');

      // Mark original as replied
      const smsLog = await kv.lrange('sms:log', 0, 499);
        const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
        const updated = parsed.map(e => e.to === from ? { ...e, replied: true } : e);
        await kv.del('sms:log');
        for (const e of updated.reverse()) await kv.lpush('sms:log', JSON.stringify(e));
  } catch (e) {
        console.error('KV log error:', e.message);
  }

  res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
}
