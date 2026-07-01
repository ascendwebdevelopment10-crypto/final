import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@vercel/kv';

export const config = { maxDuration: 60 };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const MAX_TURNS = 12;

function buildSystemPrompt(firstName, company, industry, painPoint) {
  return 'You are Alex, a senior Local Growth Advisor at Ascend Web Development. Calm, professional, friendly consultant NOT a telemarketer.\n\n' +
    'You are on a live call with ' + firstName + ' at ' + company + ', a ' + industry + ' business. Their digital issue: ' + painPoint + '.\n\n' +
    'FLOW:\n' +
    '1. OPENING: After intro, listen for reply. Say: "Great, I will be brief. I was searching for local ' + industry + ' teams and came across ' + company + '. I noticed your digital setup is currently ' + painPoint + '. When customers search for ' + industry + ' providers, that causes them to bounce to a competitor. Who handles your digital presence right now?"\n' +
    '2. DIAGNOSTIC: Acknowledge. Say: "Over 80% of local searches happen on mobile. That ' + painPoint + ' issue makes it hard for new clients to reach you. We specialize in fixing exactly that."\n' +
    '3. CTA: Say: "Our technical director can pull a quick 10-minute visual blueprint of your site showing exactly how to fix that ' + painPoint + ' issue. Would you be open to a 10-minute screen-share later this week, Thursday or Friday morning?"\n' +
    '4. OBJECTIONS: Send email? "I can do that, but without looking at the live setup together, an email won\'t show where the leak is. Is there a morning that works?" Word-of-mouth? "That means you run a great operation. When referrals look you up and see that ' + painPoint + ' issue, it can look like you\'re closed. Worth protecting. Does a morning slot work?"\n' +
    '5. CLOSE: If agree, ask for email. Say: "Perfect, locked you in. You will see something from Ascend Web Development in your inbox in about two minutes. Appreciate your time ' + firstName + ', talk soon!"\n\n' +
    'RULES: SHORT replies (1-3 sentences). Natural speech: gotcha, makes sense, sure, absolutely. No jargon. Never say you are AI. ' +
    'If they say goodbye or are done, say a brief farewell and end your reply with exactly: <END_CALL>. ' +
    'After 2 polite rejections, gracefully end with: <END_CALL>';
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const { firstName, company, industry, painPoint, phone, turn } = req.query;
  const speechResult = req.body?.SpeechResult || '';
  const callSid = req.body?.CallSid || '';
  const currentTurn = parseInt(turn || '0', 10);

  // Load conversation history from KV using call SID
  const historyKey = 'call:history:' + callSid;
  let messages = [];
  try {
    const stored = await kv.get(historyKey);
    if (stored) messages = typeof stored === 'string' ? JSON.parse(stored) : stored;
} catch(e) { /* start fresh */ }

  // Add the user speech to history
  if (speechResult) {
    messages.push({ role: 'user', content: speechResult });
} else if (messages.length === 0) {
    // First turn with no speech captured - prompt the AI to continue
    messages.push({ role: 'user', content: 'Hello?' });
}

  const systemPrompt = buildSystemPrompt(
    firstName || 'there',
    company || 'your business',
    industry || 'local business',
    painPoint || 'having an outdated online presence'
  );

  let aiReply = '';
  let endCall = false;

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 150,
      system: systemPrompt,
      messages
});
    aiReply = response.content[0]?.text?.trim() || 'Got it, let me follow up with you.';

    if (aiReply.includes('<END_CALL>')) {
      endCall = true;
      aiReply = aiReply.replace('<END_CALL>', '').trim();
}
} catch(e) {
    console.error('Claude error:', e.message);
    aiReply = 'Appreciate your time, talk soon!';
    endCall = true;
}

  // Save updated history (keep last 20 turns)
  messages.push({ role: 'assistant', content: aiReply });
  if (messages.length > 20) messages = messages.slice(-20);
  try {
    await kv.set(historyKey, JSON.stringify(messages), { ex: 3600 });
} catch(e) { /* non-fatal */ }

  const safeReply = escapeXml(aiReply);
  const nextTurn = currentTurn + 1;

  const nextParams = new URLSearchParams({
    firstName: firstName || 'there',
    company: company || 'your business',
    industry: industry || 'local business',
    painPoint: painPoint || 'having an outdated online presence',
    phone: phone || '',
    turn: String(nextTurn)
});

  let twiml;
  if (endCall || nextTurn >= MAX_TURNS) {
    twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">' + safeReply + '</Say><Hangup/></Response>';
} else {
    twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>' +
      '<Say voice="Polly.Joanna">' + safeReply + '</Say>' +
      '<Gather input="speech" action="/api/call-gather?' + nextParams.toString() + '" method="POST" speechTimeout="3" timeout="10" language="en-US"></Gather>' +
      '<Hangup/></Response>';
}

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml);
}
