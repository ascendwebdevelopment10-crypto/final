import { currentCustomer, rateLimit, sameOrigin } from '../lib/customer-auth.js';

export const config = { maxDuration: 30 };

const clean = (value, max = 1800) => String(value || '').trim().slice(0, max);

async function elevenLabsVoice(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = clean(process.env.ELEVENLABS_VOICE_ID, 100);
  if (!apiKey || !voiceId) return null;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: clean(process.env.ELEVENLABS_MODEL_ID, 100) || 'eleven_flash_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!response.ok) {
    const message = clean(await response.text().catch(() => ''), 500);
    console.error(JSON.stringify({ level: 'error', msg: 'elevenlabs_tts_failed', status: response.status, detail: message }));
    return null;
  }
  return { audio: Buffer.from(await response.arrayBuffer()), provider: 'elevenlabs' };
}

async function openAIVoice(text) {
  if (!process.env.OPENAI_API_KEY) return null;
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.OPENAI_TTS_VOICE || 'marin', input: text, response_format: 'mp3', instructions: 'Speak naturally, warmly, and conversationally. Do not sound like an advertisement or announcer.' }),
  });
  if (!response.ok) {
    const message = clean(await response.text().catch(() => ''), 500);
    console.error(JSON.stringify({ level: 'error', msg: 'openai_tts_failed', status: response.status, detail: message }));
    return null;
  }
  return { audio: Buffer.from(await response.arrayBuffer()), provider: 'openai' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin.' }); return; }

  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  if (!await rateLimit(`operator-voice:${user.id}`, 40, 60)) {
    res.status(429).json({ error: 'Please wait a moment before using voice again.' }); return;
  }

  const text = clean(req.body?.text);
  if (!text) { res.status(400).json({ error: 'There is nothing to say.' }); return; }

  try {
    const result = await elevenLabsVoice(text) || await openAIVoice(text);
    if (!result) { res.status(503).json({ error: 'Natural voice is not configured.' }); return; }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(result.audio.length));
    res.setHeader('X-Nitro-Voice', result.provider);
    res.status(200).send(result.audio);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'elevenlabs_tts_error', error: clean(error?.message, 500) }));
    res.status(502).json({ error: 'Natural voice is temporarily unavailable.' });
  }
}
