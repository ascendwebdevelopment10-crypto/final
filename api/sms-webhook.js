import twilio from 'twilio';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';
import { sendEmail } from '../lib/mailer.js';
const NOTIFY_EMAIL = 'tysmith327@icloud.com';

const FORWARD_TO = '+13854716500';
const SIGNOFF = '\n- Ty Smith, Owner of Ascend Web Development';
const REPLY_DELAY_MS = 3 * 60 * 1000; // wait ~3 minutes before actually sending the reply
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// Fixed reply sent when the incoming text looks like an automated / auto-responder message
const AUTOMATED_REPLY_TEXT = 'No problem, get back to me when you can - I have a question for you guys.' + SIGNOFF;

// Hard cap every outbound auto-reply at one SMS segment (160 chars). Trims at a word boundary.
function capSegment(text) {
      const t = (text || '').trim();
      if (t.length <= 160) return t;
      return t.slice(0, 160).replace(/\s+\S*$/, '').trim();
}

function serviceDescription(service) {
      if (service === 'ads') return 'targeted ad campaigns';
      if (service === 'app') return 'a custom mobile app';
      return 'a professional website';
}

// Fixed pitch text (used as a fallback if the AI call fails) — kept under 160 chars (1 segment)
function fallbackPitchMessage(service) {
      return "Hey, it's Ty, owner of Ascend Web Development. We build " + serviceDescription(service) + " for local businesses & I think we could really help. Want to hear more?";
}

// Real person replied — briefly answer what they said, then a short pitch. Whole thing under 160 chars.
async function generatePitchReply(incomingBody, service, contactName) {
      const serviceDesc = serviceDescription(service);
      const prompt = `You are Ty Smith, owner of Ascend Web Development, replying by text to someone who just replied to our cold outreach SMS.

      Their reply was: "${incomingBody}"

      Write ONE very short SMS reply that does two things in one flowing message:
      1. In just a few words, acknowledge or answer what they actually said. If they asked about price/cost, say it depends on what they need - never give a specific number. If they said "yes"/"sure"/"who is this", respond naturally.
      2. Then a short pitch, close to this wording: "It's Ty, owner of Ascend Web Development - we build ${serviceDesc} for local businesses & I think we could really help. Want to hear more?"

      Rules:
      - Sound like a real, professional person texting - direct and warm, never salesy or robotic
      - Never say "ha" or "haha". No emojis.
      - CRITICAL: the ENTIRE message (acknowledgment + pitch) MUST be under 140 characters total. Keep it tight.
      - Do NOT include a sign-off or extra name at the end (the message already says Ty Smith)
      - Output ONLY the message text, nothing else`;

  const msg = await anthropic.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }]
  });
      const out = msg.content[0].text.trim().replace(/^["']|["']$/g, '').trim();
      return out.length <= 160 ? out : fallbackPitchMessage(service);
}

// Push notification via ntfy.sh — instant alert on your phone when someone replies
async function sendPushNotification(from, body, contactName) {
      try {
              const topic = process.env.NTFY_TOPIC || 'ascend-replies-8fk3q7wz';
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

// Carrier auto-responses to ignore entirely (no log, no reply)
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

// Detect an out-of-office / auto-responder style text (not a real person replying)
function isAutomatedReply(body) {
      const b = (body || '').toLowerCase();
      return /this is an automated|automated (reply|message|response|text)|auto[- ]?reply|auto[- ]?text|do not reply to this|cannot reply to this|not monitored|out of (the )?office|away from my phone|away message|currently unavailable|currently away|automatic reply/.test(b);
}

// Someone explicitly opting out / not interested — never reply to these
function isNotInterested(body) {
      const b = (body || '').toLowerCase();
      return /not interested|no thanks|no thank you|don't contact|do not contact|remove me|leave me alone|stop texting|wrong number|unsubscribe/.test(b);
}

// Verify inbound requests actually came from Twilio (X-Twilio-Signature).
// Safety valve: set SMS_SIG_CHECK=off in Vercel to disable instantly without a
// redeploy if anything misbehaves. If TWILIO_AUTH_TOKEN is unset we can't
// validate, so we allow (never block on missing config).
function fromTwilio(req) {
      if (process.env.SMS_SIG_CHECK === 'off') return true;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!token) return true;
      const sig = req.headers['x-twilio-signature'];
      if (!sig) return false;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const params = req.body || {};
      const urls = [
                  proto + '://' + host + '/sms-webhook',
                  proto + '://' + host + '/api/sms-webhook',
                  'https://final-phi-swart.vercel.app/sms-webhook',
                  'https://final-phi-swart.vercel.app/api/sms-webhook',
      ];
      return urls.some(function (u) {
                  try { return twilio.validateRequest(token, sig, u, params); } catch (e) { return false; }
      });
}

export default async function handler(req, res) {
      if (req.method !== 'POST') { res.status(405).end(); return; }
      if (!fromTwilio(req)) { res.setHeader('Content-Type','text/xml'); res.status(403).send('<Response></Response>'); return; }

  const from = req.body?.From || '';
      const body = req.body?.Body || '';
      const to = req.body?.To || '';

  // 1. If it's a carrier auto-response, stop here — no notify, no logging, no reply
  if (isAutoResponse(body)) {
          res.setHeader('Content-Type', 'text/xml');
          res.status(200).send('<Response></Response>');
          return;
  }

  // 2. Check if we already scheduled/sent a reply to this number before.
  // ONLY ever send ONE reply per person, ever — never text them again after that.
  let alreadyAutoReplied = false;
      let originalService = 'website';
      let contactName = '';
      try {
              const alreadyInSet = await kv.sismember('sms:auto_replied_numbers', from);
              const smsLog = await kv.lrange('sms:log', 0, 499);
              const parsed = smsLog.map(r => typeof r === 'string' ? JSON.parse(r) : r);
              const alreadyInLog = parsed.some(e => e.to === from && e.segment === 'auto_reply');
              alreadyAutoReplied = alreadyInSet || alreadyInLog;
              const original = parsed.find(e => e.to === from && e.type === 'sms' && e.segment !== 'auto_reply');
              if (original) {
                        originalService = original.service || 'website';
                        contactName = original.contactName || '';
              }
      } catch (e) {
              console.error('KV lookup error:', e.message);
      }

  // 3. Log as a real reply (single incr — no duplicates)
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

  // Generate a TAILORED suggested reply for Ty to review & send himself. No auto-send.
  let suggestedReply = '';
  if (!isNotInterested(body) && !isAutomatedReply(body)) {
          try { suggestedReply = await generatePitchReply(body, originalService, contactName); }
          catch (e) { console.error('Suggested reply gen error:', e.message); }
  }

  // 4. Notify Ty's phone by text (now includes the suggested reply he can edit & send)
  try {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await client.messages.create({
                    body: 'New reply - Ascend Outreach\nFrom: ' + (contactName || from) + ' (' + from + ')\nThey said: ' + body + (suggestedReply ? '\n\nSuggested reply (edit & send):\n' + suggestedReply : ''),
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: FORWARD_TO
          });
  } catch (e) {
          console.error('Twilio notify error:', e.message);
  }

  // 5. Push notification only. (Email alert removed to conserve Resend daily quota —
  // you already get a text to your phone + the dashboard entry for every reply.)
  await sendPushNotification(from, body, contactName);

  // Auto-replies disabled: Ty sends replies himself using the suggested reply above.

  res.setHeader('Content-Type', 'text/xml');
      res.status(200).send('<Response></Response>');
}
