import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ElevenLabs voice route keeps credentials server-side and protects requests', async () => {
  const source = await readFile(new URL('../api/operator-voice.js', import.meta.url), 'utf8');
  assert.match(source, /api\.elevenlabs\.io\/v1\/text-to-speech/);
  assert.match(source, /api\.openai\.com\/v1\/audio\/speech/);
  assert.match(source, /elevenLabsVoice\(text\) \|\| await openAIVoice\(text\)/);
  assert.match(source, /ELEVENLABS_API_KEY/);
  assert.match(source, /ELEVENLABS_VOICE_ID/);
  assert.match(source, /'xi-api-key': apiKey/);
  assert.match(source, /currentCustomer\(req\)/);
  assert.match(source, /sameOrigin\(req\)/);
  assert.match(source, /rateLimit/);
  assert.match(source, /Cache-Control', 'no-store/);
  assert.doesNotMatch(source, /sk_[a-zA-Z0-9]{20,}/);
});
