import Anthropic from '@anthropic-ai/sdk';
import { currentCustomer, sameOrigin, saveCustomer, rateLimit } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';

function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function textOf(message) { return message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() || ''; }
function workspace(user) {
  user.workspace = user.workspace || { websites: [], content: [], socialDrafts: [], campaigns: [], assistant: [], messages: [] };
  for (const key of ['websites', 'content', 'socialDrafts', 'campaigns', 'assistant', 'messages']) {
    if (!Array.isArray(user.workspace[key])) user.workspace[key] = [];
  }
  user.usage = user.usage || {};
  user.usage.aiUsed = Number(user.usage.aiUsed || 0);
  return user.workspace;
}
function usageError(plan) { return `You've used all ${plan.aiCredits} AI credits on the ${plan.name} plan. Upgrade to continue.`; }
function companyContext(user) {
  const data = user.onboarding?.data || {};
  return {
    company: clean(data.businessName || data.company || user.businessName || 'the business', 160),
    industry: clean(data.industry || user.industry || 'small business', 160),
    audience: clean(data.audience || data.targetAudience || '', 300),
    offer: clean(data.offer || data.description || data.businessDescription || '', 500),
  };
}
async function generateOpenAI(prompt, maxTokens) {
  if (!process.env.OPENAI_API_KEY) throw new Error('AI generation is not configured.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You are Nitro Content Studio. Write distinctive, natural marketing content for real small businesses. Never repeat a prior creative structure when alternatives exist.' },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: Math.max(700, Math.ceil(maxTokens * 1.5)),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  return clean(data?.choices?.[0]?.message?.content, 8000);
}
async function generate(prompt, maxTokens = 750) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.95,
        messages: [{ role: 'user', content: prompt }],
      });
      return textOf(result);
    } catch (error) {
      console.error('Diverse content generation failed over to OpenAI:', error.message);
    }
  }
  return generateOpenAI(prompt, maxTokens);
}

const ANGLES = [
  'contrarian myth-buster', 'quick practical lesson', 'before-versus-after transformation',
  'specific problem and solution', 'mini story from the customer point of view', 'strong opinion with useful reasoning',
  'mistake-to-avoid', 'checklist or framework', 'behind-the-scenes perspective', 'direct offer spotlight',
  'frequently asked question', 'unexpected observation', 'comparison', 'micro case-study structure without invented results',
];
const HOOKS = [
  'short punchy statement', 'curiosity gap', 'direct question', 'counterintuitive claim', 'specific pain point',
  'one-line scenario', 'bold imperative', 'mini confession-style opener', 'pattern interrupt', 'simple numbered hook',
];
const STRUCTURES = [
  '2-4 very short paragraphs', 'hook + three compact bullets + CTA', 'single flowing conversational paragraph + CTA',
  'question + answer + takeaway', 'problem / why it happens / what to do next', 'three-line punch format + explanation',
  'mini story with a turn in the middle', 'headline + compact checklist', 'observation + lesson + invitation',
];
const CTAS = [
  'ask a low-friction question', 'invite a DM', 'invite them to try the product', 'invite them to learn more',
  'invite them to save the post', 'invite them to share it with someone relevant', 'use a direct but non-pushy next step',
];
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function recentFingerprint(data) {
  return (data.content || []).slice(0, 8).map(item => clean(item.text, 700)).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin.' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
  if (!(await rateLimit(`content-v2:${user.id}`, 30, 60 * 60))) { res.status(429).json({ error: 'Too many generations. Try again shortly.' }); return; }

  const body = req.body || {};
  const topic = clean(body.topic, 600);
  if (!topic) { res.status(400).json({ error: 'Enter a topic for the content.' }); return; }
  const format = clean(body.format, 40) || 'social post';
  const plan = planFor(user.plan || user.planId || 'free');
  const data = workspace(user);
  if (plan.aiCredits != null && user.usage.aiUsed >= plan.aiCredits) { res.status(403).json({ error: usageError(plan) }); return; }

  const ctx = companyContext(user);
  const recent = recentFingerprint(data);
  const seed = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const angle = pick(ANGLES), hook = pick(HOOKS), structure = pick(STRUCTURES), cta = pick(CTAS);
  const recentBlock = recent.length
    ? `\nRECENT POSTS TO AVOID COPYING OR PARAPHRASING:\n${recent.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n`
    : '';
  const prompt = `Create ONE ready-to-post ${format} for ${ctx.company}.
Topic/request: ${topic}
Industry: ${ctx.industry}${ctx.audience ? `\nAudience: ${ctx.audience}` : ''}${ctx.offer ? `\nBusiness context: ${ctx.offer}` : ''}

CREATIVE DIRECTION FOR THIS GENERATION
- Variation seed: ${seed}
- Content angle: ${angle}
- Hook style: ${hook}
- Structure: ${structure}
- CTA style: ${cta}

NON-REPETITION RULES
- This generation must feel materially different from recent outputs, not like the same template with synonyms.
- Change the opening rhythm, sentence lengths, body structure, emphasis, CTA wording, and hashtag mix.
- Do not reuse a prior hook, slogan, first sentence, list pattern, or closing line.
- Do not default to “Are you tired of…”, “Stop…”, “Here’s the truth…”, “Game changer”, “level up”, or generic AI-marketing language unless the user explicitly asks for it.
- Prefer concrete language tied to this business/topic over generic marketing filler.
- Never invent results, customer counts, testimonials, prices, statistics, awards, or guarantees.
- Keep it natural enough that a real business owner would post it.
- Include 0-5 hashtags only when they genuinely fit; vary the count rather than always using the same number.
${recentBlock}
Return ONLY the finished post copy. No labels, explanation, quotation marks, or creative-direction notes.`;

  const content = await generate(prompt, 850);
  if (!content) { res.status(502).json({ error: 'The post could not be generated. Try again.' }); return; }
  const item = {
    id: id('content'), topic, format, text: clean(content, 5000),
    variation: { angle, hook, structure, cta, seed }, createdAt: new Date().toISOString(),
  };
  data.content.unshift(item);
  data.content = data.content.slice(0, plan.id === 'free' ? 10 : 100);
  user.usage.aiUsed += 1;
  await saveCustomer(user);
  res.status(201).json({ ok: true, content: item, aiUsed: user.usage.aiUsed });
}
