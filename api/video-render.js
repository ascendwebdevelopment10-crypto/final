import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';
import { currentCustomer, rateLimit, requestOrigin, sameOrigin, saveCustomer } from '../lib/customer-auth.js';

export const config = { maxDuration: 60 };

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CREDIT_COST = { 15: 1, 30: 2, 45: 3 };

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function renderSecret() { return process.env.MODAL_SHARED_SECRET || ''; }
function signJob(jobId, customerId) {
  return crypto.createHmac('sha256', renderSecret()).update(`${jobId}:${customerId}`).digest('hex');
}
function textOf(message) {
  return message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() || '';
}
function fallbackPlan(prompt, company, cta) {
  const subject = clean(prompt, 90) || `See what ${company} can do`;
  return {
    title: subject,
    caption: `${subject}\n\n${cta}`,
    scenes: [
      { eyebrow: 'STOP SCROLLING', headline: subject, body: 'There is a faster, cleaner way to get results.' },
      { eyebrow: 'THE PROBLEM', headline: 'Busy work steals your momentum', body: 'Manual steps slow you down and make growth harder.' },
      { eyebrow: 'THE SOLUTION', headline: `Meet ${company}`, body: 'A smarter workflow built to keep everything moving.' },
      { eyebrow: 'WHY IT WORKS', headline: 'Simple. Fast. Built for growth.', body: 'Spend less time managing and more time winning customers.' },
      { eyebrow: 'READY TO GROW?', headline: cta, body: company },
    ],
  };
}
async function createPlan({ prompt, company, industry, tone, cta, duration }) {
  const fallback = fallbackPlan(prompt, company, cta);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  const sceneCount = duration === 15 ? 4 : duration === 30 ? 6 : 8;
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

Create exactly ${sceneCount} fast scenes. Each scene needs:
- eyebrow: 2-4 uppercase words
- headline: punchy, maximum 52 characters
- body: one specific supporting sentence, maximum 95 characters

Scene 1 must be a scroll-stopping hook. Middle scenes must make a clear problem/solution or benefit argument. Last scene must be the CTA. Do not invent statistics, testimonials, awards, or guarantees.

Return ONLY valid JSON:
{"title":"short project title","caption":"Instagram caption with 3-5 hashtags","scenes":[{"eyebrow":"...","headline":"...","body":"..."}]}`,
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
      scenes: parsed.scenes.slice(0, sceneCount).map(scene => ({
        eyebrow: clean(scene?.eyebrow, 32).toUpperCase() || 'NITRO',
        headline: clean(scene?.headline, 70) || company,
        body: clean(scene?.body, 130) || cta,
      })),
    };
  } catch {
    return fallback;
  }
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
  let plan;
  try {
    plan = await createPlan({ prompt, company, industry, tone, cta, duration });
  } catch (error) {
    console.error('Reel plan generation error:', error.message);
    plan = fallbackPlan(prompt, company, cta);
  }

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
    creditCost,
    chargedCredits: isOwner ? 0 : creditCost,
    createdAt: now,
    updatedAt: now,
  };
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
      accent: clean(user.onboarding?.data?.primaryColor, 20) || '#ff6b00',
    },
    balance: Number(user.usage.videoCredits || 0),
    ownerUnlimited: isOwner,
  });
}
