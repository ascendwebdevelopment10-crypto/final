import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';
import { currentCustomer, rateLimit, requestOrigin, sameOrigin, saveCustomer } from '../lib/customer-auth.js';

export const config = { maxDuration: 300 };

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CREDIT_COST = { 15: 1, 30: 2, 45: 3 };
const VISUAL_WORLDS = ['sky_flight', 'computer_tunnel', 'desk_person', 'city_motion', 'product_stage', 'data_stream', 'orbit', 'paper_world', 'storefront', 'interface_world'];
const CAMERA_MOVES = ['dive forward', 'orbit clockwise', 'crane upward', 'push through', 'whip left', 'float backward', 'rapid zoom', 'slow parallax'];
const STORY_SHAPES = [
  'cold open, surprising reveal, rising momentum, satisfying payoff',
  'mini day-in-the-life, interruption, discovery, transformed ending',
  'visual metaphor, escalating journey, product reveal, emotional payoff',
  'question-led hook, immersive demonstration, proof through action, invitation',
  'before-and-after contrast told as one cinematic transformation',
  'product-demo journey that travels through the customer experience',
];
function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function renderSecret() { return process.env.MODAL_SHARED_SECRET || ''; }
function normalizedHex(value) {
  const color = clean(value, 12).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(color) ? color : hexColor();
}
function signJob(jobId, customerId) {
  return crypto.createHmac('sha256', renderSecret()).update(`${jobId}:${customerId}`).digest('hex');
}
function textOf(message) {
  return message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() || '';
}
function hexColor() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function chooseDirection(prompt = '') {
  const lower = prompt.toLowerCase();
  let world = VISUAL_WORLDS[crypto.randomInt(0, VISUAL_WORLDS.length)];
  if (/(computer|software|app|dashboard|technology|automation)/.test(lower)) world = 'computer_tunnel';
  else if (/(desk|office|work|employee|business owner)/.test(lower)) world = 'desk_person';
  else if (/(fly|air|sky|travel|freedom)/.test(lower)) world = 'sky_flight';
  else if (/(shop|store|restaurant|local|location)/.test(lower)) world = 'storefront';
  return {
    id: crypto.randomBytes(8).toString('hex'),
    palette: [hexColor(), hexColor(), hexColor()],
    world,
    camera: CAMERA_MOVES[crypto.randomInt(0, CAMERA_MOVES.length)],
    storyShape: STORY_SHAPES[crypto.randomInt(0, STORY_SHAPES.length)],
    geometrySeed: crypto.randomBytes(8).toString('hex'),
    musicSeed: crypto.randomBytes(8).toString('hex'),
  };
}
function fallbackPlan(prompt, company, cta, direction = chooseDirection(prompt)) {
  const subject = clean(prompt, 90) || `See what ${company} can do`;
  return {
    title: subject,
    caption: `${subject}\n\n${cta}`,
    creative: direction,
    scenes: [
      { headline: subject, voiceover: subject, visual: direction.world, camera: direction.camera, transition: 'continuous dissolve', textStyle: 'cinematic overlay' },
      { headline: company, voiceover: `${company} turns the idea into action.`, visual: VISUAL_WORLDS[crypto.randomInt(0, VISUAL_WORLDS.length)], camera: CAMERA_MOVES[crypto.randomInt(0, CAMERA_MOVES.length)], transition: 'continuous dissolve', textStyle: 'cinematic overlay' },
      { headline: cta, voiceover: `${cta} with ${company}.`, visual: 'product_stage', camera: 'push through', transition: 'continuous dissolve', textStyle: 'cinematic overlay' },
    ],
  };
}
async function createPlan({ prompt, company, industry, tone, cta, duration, direction }) {
  const fallback = fallbackPlan(prompt, company, cta, direction);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  const sceneCount = duration === 15 ? 3 : duration === 30 ? 4 : 5;
  const result = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 1500,
    temperature: 0.7,
    messages: [{
      role: 'user',
      content: `You are a direct-response video ad creative director. Write a ${duration}-second vertical Reel ad for:
Business: ${company}
Industry: ${industry}
User request: ${prompt}
Tone: ${tone}
Final CTA: ${cta}
Starting visual idea: ${direction.world}
Starting camera move: ${direction.camera}
Random palette seed: ${direction.palette.join(', ')}
Story shape for this render: ${direction.storyShape}

Plan exactly ${sceneCount} visual beats that blend into one uninterrupted piece of footage. Each beat needs:
- headline: a short phrase used only for the opening hook or final CTA, maximum 52 characters
- voiceover: the next natural phrase in one continuous spoken thought, maximum 30 words
- visual: choose the most relevant world from ${VISUAL_WORLDS.join(', ')}
- camera: a camera move that continues the direction and energy of the previous beat

This must feel like a normal cinematic video, not slides with sections. The camera and subject should appear to keep moving through one connected world while imagery blends naturally. Do not create title cards, information panels, section labels, numbered steps, bullet points, or repeated text layouts. Only the opening phrase and final CTA may appear on screen; the middle must be visual footage with narration. Never write "first/second/third" or use a problem/solution/benefits list structure. It may fly through the air, travel inside a computer, follow a person through a real workspace, orbit a product, or move through a city/storefront when relevant. Narration must be one coherent human thought with natural sentence flow and contractions—not isolated lines written for separate scenes. Avoid generic phrases such as "stop scrolling," "game changer," "work smarter," "built for growth," or "take the next step." Do not invent statistics, testimonials, awards, or guarantees. Write original wording specific to this exact request.

Return ONLY valid JSON:
{"title":"short project title","caption":"Instagram caption with 3-5 hashtags","creative":{"palette":["6-digit hex","6-digit hex","6-digit hex"],"world":"specific connected visual world","camera":"one continuous camera concept","music":"specific music mood"},"scenes":[{"headline":"...","voiceover":"...","visual":"one allowed visual world","camera":"continuing camera move"}]}`,
    }],
  });
  try {
    const raw = textOf(result);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 3) return fallback;
    return {
      title: clean(parsed.title, 90) || fallback.title,
      caption: clean(parsed.caption, 1800) || fallback.caption,
      creative: {
        ...direction,
        palette: Array.isArray(parsed.creative?.palette) && parsed.creative.palette.length >= 3
          ? parsed.creative.palette.slice(0, 3).map(normalizedHex)
          : direction.palette,
        world: clean(parsed.creative?.world, 80) || direction.world,
        camera: clean(parsed.creative?.camera, 120) || direction.camera,
        music: clean(parsed.creative?.music, 120) || 'cinematic electronic pulse',
      },
      scenes: parsed.scenes.slice(0, sceneCount).map(scene => ({
        headline: clean(scene?.headline, 70) || company,
        voiceover: clean(scene?.voiceover, 260) || cta,
        visual: VISUAL_WORLDS.includes(clean(scene?.visual, 40)) ? clean(scene.visual, 40) : direction.world,
        camera: clean(scene?.camera, 80) || direction.camera,
        transition: 'continuous dissolve',
        textStyle: 'cinematic overlay',
      })),
    };
  } catch {
    return fallback;
  }
}

async function createVoiceover(plan, tone, voiceMode, customVoiceover) {
  if (!process.env.OPENAI_API_KEY) return '';
  if (voiceMode === 'none') return '';
  const input = voiceMode === 'custom'
    ? clean(customVoiceover, 1600)
    : plan.scenes.map(scene => clean(scene.voiceover, 180)).filter(Boolean).join(' ');
  if (!input) return '';
  const voice = voiceMode === 'commercial' || tone === 'bold' ? 'cedar' : 'marin';
  const delivery = {
    recommended: 'Sound like a confident founder naturally explaining something useful to one person.',
    founder: 'Sound like a real founder recording a relaxed voice note: grounded, personal, and quietly confident.',
    warm: 'Sound warm, thoughtful, and human, like a trusted storyteller speaking to one person.',
    commercial: 'Sound polished and assured, but restrained and believable—not like a radio announcer.',
    custom: 'Honor the writer’s wording while making it feel spoken, spontaneous, and emotionally believable.',
  }[voiceMode] || 'Sound conversational, grounded, and human.';
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice,
        input: input.slice(0, 4000),
        instructions: `${delivery} Read it as one continuous take. Use contractions, varied sentence rhythm, subtle breaths, and short meaningful pauses. Never announce scene numbers or sound like a list. Avoid sing-song intonation, exaggerated enthusiasm, over-enunciation, and the predictable AI narrator cadence. ${tone === 'energetic' ? 'Keep the energy alive through pacing, not shouting.' : 'Keep the pace unhurried but never sleepy.'}`,
        speed: 0.97,
        response_format: 'mp3',
      }),
    });
    if (!response.ok) return '';
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  } catch {
    return '';
  }
}

const WORLD_PROMPTS = {
  sky_flight: 'an exhilarating aerial flight above sculpted clouds with dramatic depth and forward momentum',
  computer_tunnel: 'a cinematic camera journey through the glowing interior of a computer into a digital business network',
  desk_person: 'a real small-business owner working at a modern desk, monitor glow, authentic office details and human emotion',
  city_motion: 'a dynamic street-level camera move through a modern city where local businesses come alive',
  product_stage: 'a premium product reveal on a sculptural advertising set with dramatic studio lighting',
  data_stream: 'a flowing world of luminous customer signals, lead paths and connected data particles',
  orbit: 'a sweeping orbital camera move around a central product or service represented as a premium physical object',
  paper_world: 'a tactile handcrafted paper world with dimensional layers, shadows and playful physical motion',
  storefront: 'a welcoming real-world storefront with customers arriving and energetic local-business atmosphere',
  interface_world: 'a dimensional software world with floating glass panels and visual workflow elements, without readable UI text',
};

async function createSceneArt(plan, prompt, company, tone) {
  if (!process.env.OPENAI_API_KEY) return [];
  const palette = (plan.creative?.palette || []).map(color => `#${color}`).join(', ');
  const jobs = plan.scenes.map(async (scene, index) => {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: `Create visual beat ${index + 1} of one continuous vertical social-media commercial for ${company}.
Overall ad request: ${prompt}
This moment: ${WORLD_PROMPTS[scene.visual] || scene.visual}. Story beat: ${scene.headline}. Camera: ${scene.camera}.
Style: ${tone} high-end cinematic advertising, believable depth, sophisticated lighting, richly detailed, polished color grade.
Use this palette as inspiration: ${palette}. Keep the same cinematic world, lighting logic, subject continuity, and forward motion as the adjoining moments so long dissolves feel like one connected shot. Compose for a 9:16 frame.
No words, captions, letters, logos, watermarks, split screens, posters, title cards, presentation panels, or flat graphic backgrounds.`,
        size: '1024x1536',
        quality: 'low',
        output_format: 'jpeg',
        output_compression: 55,
      }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    return clean(data?.data?.[0]?.b64_json, 2_500_000);
  });
  const results = await Promise.allSettled(jobs);
  return results.map(result => result.status === 'fulfilled' ? result.value : '');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method === 'GET') {
    const jobId = clean(req.query?.jobId, 100);
    if (!jobId) {
      res.status(200).json({
        configured: Boolean(process.env.MODAL_RENDER_URL && renderSecret()),
        balance: Number(user.usage?.videoCredits || 0),
        ownerUnlimited: String(user.email || '').toLowerCase() === OWNER_EMAIL,
        pricing: CREDIT_COST,
      });
      return;
    }
    const stored = await kv.get(`video:job:${jobId}`);
    const job = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (!job || job.customerId !== user.id) { res.status(404).json({ error: 'Render not found' }); return; }
    res.status(200).json({ job }); return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (!process.env.MODAL_RENDER_URL || !renderSecret()) {
    res.status(503).json({ error: 'The Reel renderer is being connected. Try again shortly.' }); return;
  }
  if (!await rateLimit(`video-render:${user.id}`, 2, 30)) {
    res.status(429).json({ error: 'Please wait before starting another render.' }); return;
  }

  const prompt = clean(req.body?.prompt, 1200);
  if (!prompt) { res.status(400).json({ error: 'Describe the Reel you want Nitro to create.' }); return; }
  const duration = [15, 30, 45].includes(Number(req.body?.duration)) ? Number(req.body.duration) : 15;
  const creditCost = CREDIT_COST[duration];
  const isOwner = String(user.email || '').toLowerCase() === OWNER_EMAIL;
  user.usage = user.usage || {};
  const balance = Number(user.usage.videoCredits || 0);
  if (!isOwner && balance < creditCost) {
    res.status(402).json({
      error: `This ${duration}-second Reel uses ${creditCost} credit${creditCost === 1 ? '' : 's'}. Add credits to continue.`,
      needsCredits: true,
      creditCost,
    });
    return;
  }

  const company = clean(user.company?.name || user.companyName || user.onboarding?.data?.companyName, 100) || 'Your Business';
  const industry = clean(user.company?.industry || user.onboarding?.data?.industry, 100) || 'business';
  const tone = ['bold', 'premium', 'energetic', 'minimal'].includes(clean(req.body?.tone, 20))
    ? clean(req.body.tone, 20) : 'bold';
  const cta = clean(req.body?.cta, 70) || 'Start today';
  const voiceMode = ['recommended', 'founder', 'warm', 'commercial', 'custom', 'none'].includes(clean(req.body?.voiceMode, 30))
    ? clean(req.body.voiceMode, 30) : 'recommended';
  const customVoiceover = clean(req.body?.customVoiceover, 1600);
  if (voiceMode === 'custom' && !customVoiceover) {
    res.status(400).json({ error: 'Add your voiceover text or choose a recommended voice style.' }); return;
  }
  const direction = chooseDirection(prompt);
  let plan;
  try {
    plan = await createPlan({ prompt, company, industry, tone, cta, duration, direction });
  } catch (error) {
    console.error('Reel plan generation error:', error.message);
    plan = fallbackPlan(prompt, company, cta, direction);
  }

  const [voiceover, sceneArt] = await Promise.all([
    createVoiceover(plan, tone, voiceMode, customVoiceover),
    createSceneArt(plan, prompt, company, tone),
  ]);
  const jobId = `reel_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();
  const job = {
    id: jobId,
    customerId: user.id,
    status: 'ready_to_render',
    progress: 10,
    title: plan.title,
    prompt,
    caption: plan.caption,
    duration,
    tone,
    voiceMode,
    voiceoverIncluded: Boolean(voiceover),
    generatedSceneCount: sceneArt.filter(Boolean).length,
    creditCost,
    chargedCredits: isOwner ? 0 : creditCost,
    createdAt: now,
    updatedAt: now,
  };
  user.usage.lastReelStyle = plan.creative?.id || direction.id;
  user.usage.reelStyleHistory = [...(Array.isArray(user.usage.reelStyleHistory) ? user.usage.reelStyleHistory : []), plan.creative?.id || direction.id].slice(-8);
  if (!isOwner) user.usage.videoCredits = balance - creditCost;
  await saveCustomer(user);
  await kv.set(`video:job:${jobId}`, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
  res.status(201).json({
    job,
    renderUrl: `${process.env.MODAL_RENDER_URL.replace(/\/$/, '')}/render-prompt`,
    fields: {
      jobId,
      customerId: user.id,
      token: signJob(jobId, user.id),
      callbackUrl: `${requestOrigin(req)}/api/video-render-callback`,
      downloadBase: process.env.MODAL_RENDER_URL.replace(/\/$/, ''),
      plan: JSON.stringify(plan),
      duration: String(duration),
      tone,
      creative: JSON.stringify(plan.creative || direction),
      voiceover,
      sceneArt: JSON.stringify(sceneArt),
    },
    balance: Number(user.usage.videoCredits || 0),
    ownerUnlimited: isOwner,
  });
}
