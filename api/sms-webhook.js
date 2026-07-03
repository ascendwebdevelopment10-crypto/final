import twilio from 'twilio';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';

const FORWARD_TO = '+13854716500';
const SIGNOFF = '\n- Ty Smith, Owner of Ascend Web Development';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// Push notification via ntfy.sh — instant alert on your phone when someone replies
async function sendPushNotification(from, body, contactName) {
  try {
    const topic = process.env.NTFY_TOPIC || 'ascend-replies';
    const title = contactName ? `Reply from ${contactName}` : `New SMS Reply`;
    const message = `${from}: ${body.slice(0, 200)}`;
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'high',
        'Tags': 'speech_balloon,phone',
        'Content-Type': 'text/plain'
      },
      body: message
    });
  } catch (e) {
    console.error('ntfy push error:', e.message);
  }
}

// Carrier auto-responses to ignore
function isAutoResponse(body) {
  const b = (body || '').toLowerCase().trim();
  return (
    b.startsWith('[sys-msg]') ||
    b.startsWith('[sys_msg]') ||
    /^(stop|unstop|help|info|cancel|end|quit|unsubscribe)$/.test(b) ||
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
  return 'general';
}

async function generateAutoReply(incomingBody, originalOutbound) {
  const replyType = classifyReply(incomingBody);
  if (replyType === 'not_interested') return null;

  const originalContext = originalOutbound
    ? `Our original message to them was: "${originalOutbound}"`
    : 'We sent them a cold outreach SMS about web development services.';

  let instructions = '';
  if (replyType === 'has_provider') {
    instructions = `They already have someone handling this. Acknowledge it genuinely — don't push. Ask one light question that might open a door (e.g. are they happy with results, are they getting leads from it). Keep it friendly and zero-pressure. Goal is to stay on their radar, not close them now.`;
  } else if (replyType === 'wants_pricing') {
    instructions = `They want to know about cost. Don't give a specific price — say it depends on what they need and offer a quick 10-minute call to figure out what makes sense. Make it easy and low-pressure.`;
  } else if (replyType === 'interested') {
    instructions = `They seem interested or said yes. Lock in a next step — ask if they have 10 minutes for a quick call this week, or ask for their best time. Be direct but warm. Don't oversell. Move fast.`;
  } else if (replyType === 'maybe_later') {
    instructions = `They said it's not a great time. Respect that fully. Ask when a better time would be — offer to follow up next week or whenever works. No pressure at all.`;
  } else if (replyType === 'wants_context') {
    instructions = `They want to know who we are or how we got their number. Be transparent and friendly — explain you found their business online and reached out because you thought there might be a fit. Briefly say what Ascend Web Dev does (websites, ads, apps for local businesses). Keep it short.`;
  } else {
    instructions = `Their reply is ambiguous — treat it as mild interest. Respond naturally to what they actually said, then ask one simple easy question to keep the conversation moving. Be conversational, not salesy.`;
  }

  const prompt = `You are Ty Smith, owner of Ascend Web Development, responding via SMS. We help small businesses with websites, Google/Meta ads, and custom apps.

Context:
- ${originalContext}
- Their reply was: "${incomingBody}"
- Reply type: ${replyType}

Your task: ${instructions}

Rules:
- Write like a real person texting — casual, warm, direct
- Address what they ACTUALLY said — don't ignore it
- Keep it under 160 characters (the sign-off will be added automatically, do NOT include it)
- Do NOT include any name, sign-off, or website link in your output
- No emojis
- No generic openers like "Great question!" or "I totally understand"
- Output ONLY the message body text, nothing else`;

  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }]
  });

  const msgBody = msg.content[0].text.trim().replace(/^["']|["']$/g, '').trim();
  return msgBody + SIGNOFF;
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

  // 2. If it's a carrier auto-response, stop here — no logging, no reply
  if (isAutoResponse(body)) {
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
    return;
  }

  // 3. Check if we already sent an auto-reply to this number before.
  // ONLY send one auto-reply per person, ever. After that, they talk to Ty directly.
  let alreadyAutoReplied = false;
  let originalOutbound = null;
  let contactName = '';
  try {
    const smsLog = await kv.lrange('sms:log', 0, 499);
    const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
    // Has an auto_reply already been sent TO this number?
    alreadyAutoReplied = parsed.some(e => e.to === from && e.segment === 'auto_reply');
    // Grab the original cold outbound message for context
    const original = parsed.find(e => e.to === from && e.type === 'sms' && e.segment !== 'auto_reply');
    if (original) {
      originalOutbound = original.body;
      contactName = original.contactName || '';
    }
  } catch (e) {
    console.error('KV lookup error:', e.message);
  }

  // 4. Log as a real reply (single incr — no duplicates)
  try {
    const entry = {
      type: 'sms_reply', from, body, to,
      contactName,
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

  // 5. Send push notification to phone (ntfy.sh) — fires for every real reply
  await sendPushNotification(from, body, contactName);

  // 6. Send ONE auto-reply only — never again after that
  const replyType = classifyReply(body);
  if (!alreadyAutoReplied && replyType !== 'not_interested') {
    try {
      const autoReply = await generateAutoReply(body, originalOutbound);
      if (autoReply) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: autoReply,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: from
        });
        // Log with segment 'auto_reply' — this is what prevents future auto-replies to same person
        await kv.lpush('sms:log', JSON.stringify({
          type: 'sms', to: from, body: autoReply,
          contactName, timestamp: Date.now(),
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
