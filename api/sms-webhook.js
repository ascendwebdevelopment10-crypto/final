import twilio from 'twilio';
import { kv } from '@vercel/kv';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const FORWARD_TO = '+13854716500'; // Personal number to forward replies to

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const from = req.body?.From || '';
    const body = req.body?.Body || '';
    const to = req.body?.To || '';

    // 1. Log the SMS reply to Redis for the dashboard
    const entry = {
      type: 'sms_reply',
      from,
      body,
      to,
      timestamp: Date.now(),
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    };
    await kv.lpush('replies:log', JSON.stringify(entry));
    await kv.incr('stats:sms_replies');

    // Mark original outbound SMS as replied
    const smsLog = await kv.lrange('sms:log', 0, 499);
    const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
    const updated = parsed.map(e => e.to === from ? { ...e, replied: true } : e);
    await kv.del('sms:log');
    for (const e of updated.reverse()) await kv.lpush('sms:log', JSON.stringify(e));

    // 2. Forward the reply to your personal number
    await twilioClient.messages.create({
      body: 'SMS Reply from ' + from + ': ' + body,
      from: TWILIO_FROM,
      to: FORWARD_TO
    });

    // Respond with empty TwiML so Twilio is happy
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
  } catch (e) {
    console.error('SMS webhook error:', e.message);
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
  }
}
