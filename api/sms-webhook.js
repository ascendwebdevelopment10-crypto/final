import twilio from 'twilio';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';

const FORWARD_TO = '+13854716500';
const WEBSITE_URL = 'ascendwebdevelopment.com';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// Carrier auto-responses to ignore - do NOT count as real replies or respond to them
function isAutoResponse(body) {
      const b = (body || '').toLowerCase();
      return (
              b.startsWith('[sys-msg]') ||
              b.startsWith('[sys_msg]') ||
              /^(stop|unstop|help|info|cancel|end|quit|unsubscribe)$/i.test(b.trim()) ||
              b.includes('message & data rates may apply') ||
              b.includes('msg&data rates may apply') ||
              b.includes('reply stop to') ||
              b.includes('text stop to') ||
              b.includes('to opt out') ||
              b.includes('this number does not accept') ||
              b.includes('your message has been received') ||
              b.includes('you have been unsubscribed')
            );
}

async function generateAutoReply(from, incomingBody) {
      const prompt = `A small business owner just replied to a cold SMS from Ascend Web Development (we build websites, run ads, and make apps). Their reply was: "${incomingBody}". Write a short, friendly, human-sounding response (under 200 characters) that moves the conversation forward. If they seem interested, suggest a quick call or ask what their biggest challenge is. If they seem hesitant, be understanding and keep the door open. Sign off: - Ascend Web Dev | ${WEBSITE_URL}. No emojis. Output ONLY the reply text.`;
      const msg = await anthropic.messages.create({
              model: ANTHROPIC_MODEL,
              max_tokens: 150,
              messages: [{ role: 'user', content: prompt }]
      });
      return msg.content[0].text.trim().replace(/^["']|["']$/g, '').trim();
}

export default async function handler(req, res) {
      if (req.method !== 'POST') { res.status(405).end(); return; }

  const from = req.body?.From || '';
      const body = req.body?.Body || '';
      const to = req.body?.To || '';

  // 1. Always forward the raw reply to your phone first
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

  // 2. If it's a carrier auto-response, stop here - don't log it as a real reply
  if (isAutoResponse(body)) {
          res.setHeader('Content-Type', 'text/xml');
          res.status(200).send('<Response></Response>');
          return;
  }

  // 3. Log as a real reply (only ONE incr here, not duplicated)
  try {
          const entry = {
                    type: 'sms_reply', from, body, to,
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
  } catch (e) {
          console.error('KV log error:', e.message);
  }

  // 4. Send AI auto-reply to keep the conversation going
  try {
          const autoReply = await generateAutoReply(from, body);
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await client.messages.create({
                    body: autoReply,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: from
          });
          // Log the auto-reply we sent
        await kv.lpush('sms:log', JSON.stringify({
                  type: 'sms', to: from, body: autoReply,
                  contactName: '', timestamp: Date.now(),
                  segment: 'auto_reply', service: 'general', replied: false
        }));
  } catch (e) {
          console.error('Auto-reply error:', e.message);
  }

  res.setHeader('Content-Type', 'text/xml');
      res.status(200).send('<Response></Response>');
}
