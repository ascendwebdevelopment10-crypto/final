import twilio from 'twilio';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';

const FORWARD_TO = '+13854716500';
const WEBSITE_URL = 'ascendwebdevelopment.com';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// Carrier auto-responses to ignore
function isAutoResponse(body) {
        const b = (body || '').toLowerCase().trim();
        return (
                  b.startsWith('[sys-msg]') ||
                  b.startsWith('[sys_msg]') ||
                  /^(stop|unstop|help|info|cancel|end|quit|unsubscribe)$/i.test(b) ||
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

// Classify what kind of reply this is so we can respond appropriately
function classifyReply(body) {
        const b = (body || '').toLowerCase();

  if (/not interested|no thanks|no thank you|don't contact|do not contact|remove me|leave me alone|stop texting|wrong number|unsubscribe/i.test(b)) {
            return 'not_interested';
  }
        if (/already have|have a (website|guy|person|company|agency|team|developer)|working with|using someone|taken care of/i.test(b)) {
                  return 'has_provider';
        }
        if (/how much|what.{0,10}cost|price|pricing|rates|quote|what do you charge/i.test(b)) {
                  return 'wants_pricing';
        }
        if (/\?|tell me more|more info|what do you|how does|what is|sounds good|interested|yes|sure|ok|okay|go ahead|let.{0,5}s talk|call me|send me|more details/i.test(b)) {
                  return 'interested';
        }
        if (/busy|not right now|later|bad time|bad timing|maybe|possibly|not sure|remind me/i.test(b)) {
                  return 'maybe_later';
        }
        if (/who (is|are) (this|you)|who sent|what company|what is this|how did you get|where did you get/i.test(b)) {
                  return 'wants_context';
        }

  return 'general'; // anything else — treat as mild interest
}

async function generateAutoReply(from, incomingBody, originalOutbound) {
        const replyType = classifyReply(incomingBody);

  // Don't reply to hard opt-outs
  if (replyType === 'not_interested') return null;

  // Build context about what we originally said to them
  const originalContext = originalOutbound
          ? `Our original message to them was: "${originalOutbound}"`
            : 'We sent them a cold outreach SMS about web development services.';

  // Tailor the system instructions by reply type
  let instructions = '';

  if (replyType === 'has_provider') {
            instructions = `They already have someone handling this. Acknowledge it genuinely — don't push. Ask one light question that might open a door (e.g. are they happy with results, are they getting leads from it). Keep it friendly and zero-pressure. The goal is to stay on their radar, not close them now.`;
  } else if (replyType === 'wants_pricing') {
            instructions = `They want to know about cost. Don't give a specific price — instead say it depends on what they need and offer to hop on a quick 10-minute call to figure out what would actually make sense for their business. Make the call sound easy and low-pressure.`;
  } else if (replyType === 'interested') {
            instructions = `They seem interested or said yes. Your job is to lock in a next step — ask if they have 10 minutes for a quick call this week, or ask for their number/best time. Be direct but warm. Don't oversell. Move fast.`;
  } else if (replyType === 'maybe_later') {
            instructions = `They said it's not a great time. Respect that fully. Ask when a better time would be — offer to follow up next week or whenever works. Leave the door wide open. No pressure.`;
  } else if (replyType === 'wants_context') {
            instructions = `They want to know who we are or how we got their number. Be transparent and friendly — explain you found their business online and reached out because you thought there might be a fit. Briefly say what Ascend Web Dev does (websites, ads, apps for local businesses). Keep it short and invite them to ask anything.`;
  } else {
            // general — treat as mild interest, try to move forward
          instructions = `Their reply is a bit ambiguous — treat it as mild interest. Respond naturally to what they actually said, then try to move the conversation forward by asking one simple question that's easy to answer. Be conversational, not salesy.`;
  }

  const prompt = `You are responding on behalf of Ascend Web Development via SMS. We help small businesses with websites, Google/Meta ads, and custom apps.

  Context:
  - ${originalContext}
  - Their reply was: "${incomingBody}"
  - Reply type classified as: ${replyType}

  Your task: ${instructions}

  Rules:
  - Write like a real person texting, not a marketing bot
  - Address what they ACTUALLY said — don't ignore it
  - Under 200 characters total including sign-off
  - End with: - Ascend Web Dev | ${WEBSITE_URL}
  - No emojis
  - No generic phrases like "Great question!" or "I totally understand"
  - Output ONLY the reply text, nothing else`;

  const msg = await anthropic.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 200,
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

  // 2. If it's a carrier auto-response, stop here
  if (isAutoResponse(body)) {
            res.setHeader('Content-Type', 'text/xml');
            res.status(200).send('<Response></Response>');
            return;
  }

  // 3. Look up the original outbound SMS we sent to this number for context
  let originalOutbound = null;
        try {
                  const smsLog = await kv.lrange('sms:log', 0, 499);
                  const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
                  // Find the most recent outbound message to this number (not auto_reply type)
          const original = parsed.find(e => e.to === from && e.type === 'sms' && e.segment !== 'auto_reply');
                  if (original) originalOutbound = original.body;
        } catch (e) {
                  console.error('KV lookup error:', e.message);
        }

  // 4. Log as a real reply (single incr — no duplicates)
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

  // 5. Generate a custom reply based on what they actually said + our original message
  const replyType = classifyReply(body);

  if (replyType !== 'not_interested') {
            try {
                        const autoReply = await generateAutoReply(from, body, originalOutbound);

              if (autoReply) {
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
              }
            } catch (e) {
                        console.error('Auto-reply error:', e.message);
            }
  }

  res.setHeader('Content-Type', 'text/xml');
        res.status(200).send('<Response></Response>');
}
