import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Nitro Operator is wired into navigation, live data, voice, and command actions', async () => {
  const [client, view, css, backend, repair] = await Promise.all([
    read('../public/customer/app.js'),
    read('../views/customer.html'),
    read('../public/customer/nitro-operator-v1.css'),
    read('../api/customer-workspace.js'),
    read('../public/customer/operator-repair-v2.js'),
  ]);
  assert.match(client, /Nitro Operator/);
  assert.match(client, /operator-live-owner/);
  assert.match(client, /SpeechRecognition\|\|window\.webkitSpeechRecognition/);
  assert.match(client, /speechSynthesis/);
  assert.match(client, /\/api\/operator-voice/);
  assert.match(client, /new Audio\(state\.operatorAudioUrl\)/);
  assert.match(client, /speakBrowserVoice/);
  assert.match(client, /operatorVoiceChoice/);
  assert.match(client, /toggleOperatorConversation/);
  assert.match(client, /recognition\.interimResults=true/);
  assert.doesNotMatch(client, /agent\[5\]/);
  assert.match(client, /suggestedAction/);
  assert.match(client, /loadOperatorBrief\(\)/);
  assert.match(view, /nitro-operator-v1\.css/);
  assert.match(view, /operator-repair-v2\.js/);
  assert.match(repair, /localStorage\.getItem\('nitro-chats'\)/);
  assert.match(repair, /undefined\|null\|nan/);
  assert.match(css, /\.operator-agent-grid/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(backend, /Verified Nitro workspace snapshot/);
  assert.match(backend, /Never claim you sent, published, paused, changed, or created anything/);
  assert.match(backend, /operatorFallbackResponse/);
  assert.match(backend, /workspace_fallback/);
  assert.match(backend, /Answer normal conversation and everyday questions naturally too/);
  assert.match(backend, /api\.openai\.com\/v1\/responses/);
  assert.match(backend, /answer = await generateOperator/);
  assert.match(backend, /answer = cleanOperatorAnswer\(answer\)/);
});

test('Operator owner metrics use the existing authenticated owner endpoint', async () => {
  const client = await read('../public/customer/app.js');
  const functionBody = client.match(/async function loadOperatorBrief\(\)[\s\S]*?\n}\nfunction assistantPage/)?.[0] || '';
  assert.match(functionBody, /\/api\/owner-data/);
  assert.match(functionBody, /action:'stats'/);
  assert.match(functionBody, /action:'outreach'/);
  assert.doesNotMatch(functionBody, /Math\.random/);
});
