import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 300 };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Voicemail messages map by AMD result
function buildVoicemailTwiml(firstName, industry) {
  const msg = `Hey ${firstName}, this is Alex from Ascend Web Development. I was looking for local ${industry} providers in the area and noticed something on your digital profile I wanted to flag for you. Give me a call back at your convenience or check your texts from us. Thanks!`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${msg}</Say><Hangup/></Response>`;
}

// Build the conversation system prompt
function buildSystemPrompt(firstName, company, industry, painPoint) {
  return `You are Alex, a senior Local Growth Advisor at Ascend Web Development. Your voice is calm, approachable, and professional — like a friendly local business consultant, NOT a telemarketer.

You are on a live phone call with ${firstName} at ${company}, a ${industry} business. Their digital setup is currently ${painPoint}.

Follow this conversation flow:

1. OPENING: Greet them warmly. Say: "Hey ${firstName}, it's Alex over at Ascend Web Development. Hope your day's going well so far?" Wait for reply. Then say: "Great. I'll be brief — I know you're probably busy. I was searching for local ${industry} teams in the area and came across ${company}. I noticed your digital setup is currently ${painPoint}. When local customers are actively looking to hire a ${industry} provider, that usually causes them to bounce to a competitor. Just out of curiosity — who handles your digital presence right now?"

2. DIAGNOSTIC: Acknowledge their answer. Then say: "The main reason I wanted to flag this — over 80% of local searches for ${industry} services happen on mobile while people are in a hurry. Because of that ${painPoint} issue, it's making it tough for new clients to reach you. We specialize in fixing exactly that so local businesses capture every lead."

3. CTA: Say: "What we usually do is have our technical director pull a quick 10-minute visual blueprint of your site and local footprint — show you exactly how to fix that ${painPoint} issue so you stop losing leads to other ${industry} companies. Would you be open to a quick 10-minute screen-share later this week, say Thursday or Friday morning?"

4. OBJECTIONS:
- If they say send an email: "Absolutely, I can do that. But honestly, without looking at the live setup together, an email won't show you where the leak is. It's a dead-simple 10-minute view. Is there a morning that works?"
- If they mention word-of-mouth: "That's great — means you run a solid operation. The only reason I called is when those referrals look you up online to confirm your hours or number, that ${painPoint} issue makes it look like you might be closed. Worth protecting your reputation. Does a morning slot this week work?"

5. CLOSE: If they agree, ask for their email to send the calendar link. Say: "Perfect, locked you in. You'll see something from Ascend Web Development in your inbox in about two minutes. Appreciate your time ${firstName}, talk soon!" Then end the call naturally.

RULES:
- Keep responses SHORT — 1-3 sentences max per turn. This is a phone call.
- Use natural speech: "gotcha", "makes sense", "sure", "of course"
- Never use jargon like "synergy", "scaling", "leverage"
- Never mention you are an AI
- If they hang up or say goodbye, respond with a brief "Thanks, have a great day!" and stop`;
}

export default async function handler(req, res) {
  const { firstName, company, industry, painPoint, phone, AnsweredBy } = req.query;

  // Handle AMD (Answering Machine Detection) callback
  if (AnsweredBy === 'machine_end_beep' || AnsweredBy === 'machine_end_silence' || AnsweredBy === 'machine_end_other') {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(buildVoicemailTwiml(firstName || 'there', industry || 'local business'));
}

  // If it's a fax or failed detection, hang up
  if (AnsweredBy === 'fax') {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
}

  // Human answered — start the AI conversation using Gather + streaming
  // We use a <Gather> loop: Twilio records speech, sends it here, we reply with <Say>
  const systemPrompt = buildSystemPrompt(
    firstName || 'there',
    company || 'your business',
    industry || 'local business',
    painPoint || 'having an outdated online presence'
  );

  // Store the conversation context in the query for the gather action
  const params = new URLSearchParams({
    firstName: firstName || 'there',
    company: company || 'your business',
    industry: industry || 'local business',
    painPoint: painPoint || 'having an outdated online presence',
    phone: phone || '',
    turn: '0'
});

  const openingLine = `Hey ${firstName || 'there'}, it's Alex over at Ascend Web Development. Hope your day's going well so far?`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${openingLine}</Say>
  <Gather input="speech" action="/api/call-gather?${params.toString()}" method="POST" speechTimeout="3" timeout="10" language="en-US">
  </Gather>
  <Hangup/>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml);
}
