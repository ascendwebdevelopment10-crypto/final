import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { currentCustomer, sameOrigin, saveCustomer, rateLimit, requestOrigin } from '../lib/customer-auth.js';
import { publishImage, publishCarousel, publishReel } from '../lib/meta.js';
import { notifyBestEffort } from '../lib/ntfy.js';
import { planFor } from '../lib/customer-plans.js';
import { contentCreditBalance, migrateContentCredits, spendContentCredits } from '../lib/content-credits.js';
import { kv } from '@vercel/kv';
import { inferOperatorAction, operatorAgent, operatorPriorities, operatorSnapshot } from '../lib/nitro-operator.js';

export const config = { maxDuration: 300 };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';
const WEBSITE_MODEL = process.env.ANTHROPIC_WEBSITE_MODEL || 'claude-sonnet-5';
const WEBSITE_FALLBACK_MODEL = process.env.ANTHROPIC_WEBSITE_FALLBACK_MODEL || 'claude-sonnet-4-6';
const ADS_MODEL = process.env.ANTHROPIC_ADS_MODEL || 'claude-sonnet-5';
const ADS_FALLBACK_MODEL = process.env.ANTHROPIC_ADS_FALLBACK_MODEL || 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function workspace(user) {
  user.workspace = user.workspace || { websites: [], content: [], socialDrafts: [], campaigns: [], assistant: [], messages: [] };
  for (const key of ['websites', 'content', 'socialDrafts', 'campaigns', 'assistant', 'messages']) {
    if (!Array.isArray(user.workspace[key])) user.workspace[key] = [];
  }
  if (!user.workspace.connections || typeof user.workspace.connections !== 'object') {
    user.workspace.connections = { email: { connected: false }, sms: { connected: false } };
  }
  user.usage = user.usage || {};
  user.usage.aiUsed = Number(user.usage.aiUsed || 0);
  return user.workspace;
}
function usageError(plan) { return `You've used all ${plan.aiCredits} AI credits on the ${plan.name} plan. Upgrade to continue.`; }
function textOf(message) { return message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() || ''; }
async function generateOpenAI(prompt, maxTokens, system = 'You are Nitro Outreach, a practical small-business growth assistant.') {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI generation is not configured.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_completion_tokens: Math.max(500, Math.ceil(maxTokens * 1.4)),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  return clean(data?.choices?.[0]?.message?.content, 30000);
}
async function generate(prompt, maxTokens = 700, model = MODEL) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await anthropic.messages.create({ model, max_tokens: maxTokens, temperature: 0.6, messages: [{ role: 'user', content: prompt }] });
      return textOf(result);
    } catch (error) {
      console.error('Anthropic text generation failed; using failover:', error.message);
    }
  }
  return generateOpenAI(prompt, maxTokens);
}
async function generateWebsite(prompt) {
  const request = model => ({
    model,
    max_tokens: 4400,
    system: 'You are Nitro Site Builder, a senior conversion copywriter and award-level web designer. Produce compact, production-ready single-file websites. Follow the supplied business facts exactly and never invent proof.',
    messages: [{ role: 'user', content: prompt }],
  });
  let anthropicError = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // Sonnet 5 uses adaptive thinking by default. Disabling it keeps this
      // generation path fast while retaining the stronger writing/design model.
      const result = await anthropic.messages.create({ ...request(WEBSITE_MODEL), thinking: { type: 'disabled' } });
      return { html: textOf(result), model: WEBSITE_MODEL };
    } catch (error) {
      anthropicError = error;
      try {
        if (WEBSITE_MODEL !== WEBSITE_FALLBACK_MODEL) {
          const result = await anthropic.messages.create(request(WEBSITE_FALLBACK_MODEL));
          return { html: textOf(result), model: WEBSITE_FALLBACK_MODEL };
        }
      } catch (fallbackError) {
        anthropicError = fallbackError;
      }
    }
  }

  // Provider failover: a depleted balance or provider outage must not take the
  // customer-facing builder down. OpenAI receives the same constrained brief.
  if (process.env.OPENAI_API_KEY) {
    const system = 'You are Nitro Site Builder, a senior conversion copywriter and award-level web designer. Return only one compact, complete, self-contained HTML document. Follow supplied business facts exactly and never invent proof.';
    const primaryModel = process.env.OPENAI_WEBSITE_MODEL || 'gpt-5-mini';
    const attempts = [
      {
        model: primaryModel,
        max_completion_tokens: 12000,
        ...(/^gpt-5/i.test(primaryModel) ? { reasoning_effort: 'minimal', verbosity: 'low' } : {}),
      },
      ...(primaryModel === 'gpt-4.1-mini' ? [] : [{ model: 'gpt-4.1-mini', max_tokens: 7000 }]),
    ];
    for (const attempt of attempts) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...attempt,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const html = clean(data?.choices?.[0]?.message?.content, 120000);
        if (html) return { html, model: data.model || attempt.model };
      }
      console.error('OpenAI website failover attempt failed:', JSON.stringify({
        model: attempt.model,
        status: response.status,
        message: data?.error?.message || 'Empty model response',
        finishReason: data?.choices?.[0]?.finish_reason || null,
        usage: data?.usage || null,
      }));
    }
  }
  throw anthropicError || new Error('No website-generation provider is available.');
}
export const WEBSITE_TEMPLATES = [
  { id: 'editorial', name: 'Editorial', layout: 'an editorial masthead with oversized type, a narrow story column, overlapping image tiles, fine rules, and a magazine-like service index' },
  { id: 'split', name: 'Split Impact', layout: 'an offset split hero with the headline low on the left, a tall image breaking the grid on the right, and alternating edge-to-edge service panels' },
  { id: 'cinematic', name: 'Cinematic', layout: 'a full-bleed photographic hero with a compact copy panel near the lower edge, followed by wide visual chapters and a dark immersive closing CTA' },
  { id: 'bento', name: 'Bento', layout: 'a modular bento hero with one dominant visual, compact proof and service modules of different sizes, and a calm full-width story section' },
  { id: 'sidebar', name: 'Sidecar', layout: 'a left-side vertical navigation and brand rail with content and imagery arranged on a wide right-hand canvas; collapse the rail into a compact mobile header' },
  { id: 'storefront', name: 'Storefront', layout: 'a welcoming local-business storefront hero, a horizontal offer menu, location and hours treatment, human story, and an obvious booking/contact path' },
  { id: 'showcase', name: 'Showcase', layout: 'a portfolio-led composition with a restrained intro, large staggered project or service imagery, short captions, and a strong inquiry footer' },
  { id: 'command', name: 'Command Center', layout: 'a product-led hero with crisp interface-inspired panels, a dense capability map, workflow timeline, integration strip, and direct trial CTA' },
  { id: 'organic', name: 'Organic', layout: 'a warm flowing composition with rounded image windows, tactile color fields, an intimate story section, gentle service arcs, and generous breathing room' },
  { id: 'luxury', name: 'Luxury Minimal', layout: 'a highly restrained composition with immense negative space, refined type, one dominant image per chapter, hairline dividers, and a quiet high-intent CTA' },
];
const WEBSITE_SECTION_RHYTHMS = [
  'alternate full-width image bands with compact text sections; place services before credibility and the process near the end',
  'lead from the hero into the process, use a horizontal services rail, then place the human/about story before benefits',
  'follow the hero with a bold statement band, then an asymmetric services grid, FAQ, process, and final story-led CTA',
  'use a long editorial scroll: image-and-copy story, services, process, credibility, FAQ, then a full-bleed closing CTA',
  'use a dense bento section immediately after the hero, followed by one calm image-led section, the process, FAQ, and CTA',
  'place the differentiator story first, interleave services with imagery, and use a compact benefits strip just before the final CTA',
];
const WEBSITE_SURFACES = [
  'soft paper grain, thin rules, lightly tinted panels, and square editorial crops',
  'deep cinematic surfaces, luminous edge highlights, glass only where useful, and wide landscape crops',
  'bright gallery-like space, crisp borders, strong color blocking, and irregular image crops',
  'warm tactile surfaces, rounded image windows, subtle shadows, and layered natural color',
  'high-contrast monochrome foundations with one vivid accent, sharp corners, and dramatic image masks',
  'muted tonal layers, oversized negative space, fine typography, and restrained soft-focus imagery',
];
const WEBSITE_TYPE_STYLES = [
  'high-contrast editorial serif headlines paired with a clean sans-serif body',
  'confident condensed sans-serif headlines with a neutral, highly readable body face',
  'large geometric sans-serif display type with compact uppercase labels',
  'refined humanist typography with italic accents used sparingly for personality',
  'bold grotesk headlines with small monospaced labels and navigation details',
];
const WEBSITE_IMAGE_SETS = {
  automotive: [
    'https://images.unsplash.com/photo-1746079074522-2b14240d932c?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1565689876697-e467b6c54da2?auto=format&fit=crop&w=1600&q=85',
    'https://images.unsplash.com/photo-1762933855598-273a51b47649?auto=format&fit=crop&w=1800&q=85',
  ],
  beauty: [
    'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=85',
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1600&q=85',
  ],
  performance: [
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1400&q=85',
    'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1800&q=85',
  ],
  professional: [
    'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=85',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=85',
  ],
  technology: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=85',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=85',
  ],
  hospitality: [
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c5b?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1600&q=85',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1600&q=85',
  ],
  general: [
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1800&q=85',
    'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1600&q=85',
    'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1600&q=85',
  ],
};
function websiteDirection(industry, user, usedSignatures = [], businessBrief = '', requestedTemplate = '') {
  const value = clean(industry, 120).toLowerCase();
  const requestedBrand = clean(businessBrief, 800);
  const hasExplicitBrandDirection = /(hard brand|brand rules?|colou?r palette|typography|font system|wordmark|no gradients?|only (?:black|white|charcoal|graphite|silver|grey|gray))/i.test(requestedBrand);
  const primary = clean(user.onboarding?.data?.primaryColor, 16);
  const secondary = clean(user.onboarding?.data?.secondaryColor, 16);
  const brandColors = hasExplicitBrandDirection
    ? 'The business brief contains explicit brand direction. Follow it exactly and ignore conflicting saved workspace colors.'
    : /^#[0-9a-f]{6}$/i.test(primary) && /^#[0-9a-f]{6}$/i.test(secondary)
    ? `Use the business's saved brand colors ${primary} and ${secondary} as intentional accents.`
    : 'Choose a restrained color palette that fits the industry. If the business brief names allowed or prohibited colors, treat those instructions as hard requirements and do not introduce additional accent colors.';
  let category = 'general';
  let personality = 'confident editorial design with strong typography, asymmetric composition, tactile depth, and restrained motion';
  if (/(barber|beauty|salon|spa|fashion|flower|floral|wedding|photograph)/.test(value)) {
    category = 'beauty';
    personality = 'premium editorial design with expressive typography, warm photography-inspired framing, soft texture, and elegant spacing';
  } else if (/(automotive|auto detail|car detail|car wash|vehicle detail)/.test(value)) {
    category = 'automotive';
    personality = 'premium automotive design with deep contrast, polished metallic accents, dramatic vehicle photography, precise typography, and restrained high-performance energy';
  } else if (/(sport|fitness|gym|training|construction|roof|landscap)/.test(value)) {
    category = 'performance';
    personality = 'bold performance-focused design with energetic diagonals, strong contrast, oversized type, and action-oriented composition';
  } else if (/(law|legal|finance|account|consult|medical|dental|real estate)/.test(value)) {
    category = 'professional';
    personality = 'refined trust-first design with measured typography, calm spacing, precise grids, and a polished editorial feel';
  } else if (/(software|technology|saas|marketing|agency|automation)/.test(value)) {
    category = 'technology';
    personality = 'modern product-led design with crisp typography, layered interface-inspired visuals, subtle glow, and disciplined contrast';
  } else if (/(restaurant|food|bakery|coffee|cafe)/.test(value)) {
    category = 'hospitality';
    personality = 'warm hospitality-led design with rich color, menu-inspired rhythm, tactile surfaces, and inviting editorial composition';
  }
  const used = new Set(usedSignatures.filter(Boolean));
  const imageCount = WEBSITE_IMAGE_SETS[category].length;
  const requestedIndex = WEBSITE_TEMPLATES.findIndex(template => template.id === requestedTemplate);
  const totalRecipes = WEBSITE_TEMPLATES.length * WEBSITE_SECTION_RHYTHMS.length * WEBSITE_SURFACES.length * WEBSITE_TYPE_STYLES.length * imageCount;
  const bytes = randomBytes(2);
  const start = bytes.readUInt16BE(0) % totalRecipes;
  let selection;
  for (let attempt = 0; attempt < totalRecipes; attempt += 1) {
    let recipe = (start + attempt) % totalRecipes;
    const imageOffset = recipe % imageCount; recipe = Math.floor(recipe / imageCount);
    const typeIndex = recipe % WEBSITE_TYPE_STYLES.length; recipe = Math.floor(recipe / WEBSITE_TYPE_STYLES.length);
    const surfaceIndex = recipe % WEBSITE_SURFACES.length; recipe = Math.floor(recipe / WEBSITE_SURFACES.length);
    const rhythmIndex = recipe % WEBSITE_SECTION_RHYTHMS.length; recipe = Math.floor(recipe / WEBSITE_SECTION_RHYTHMS.length);
    const layoutIndex = requestedIndex >= 0 ? requestedIndex : recipe % WEBSITE_TEMPLATES.length;
    const signature = `${layoutIndex}-${rhythmIndex}-${surfaceIndex}-${typeIndex}-${imageOffset}`;
    selection = { layoutIndex, rhythmIndex, surfaceIndex, typeIndex, imageOffset, signature };
    if (!used.has(signature)) break;
  }
  const images = WEBSITE_IMAGE_SETS[category];
  const orderedImages = images.map((_, index) => images[(index + selection.imageOffset) % images.length]);
  return {
    signature: selection.signature,
    template: WEBSITE_TEMPLATES[selection.layoutIndex],
    brief: `${personality}. ${brandColors}\n- Template family: ${WEBSITE_TEMPLATES[selection.layoutIndex].name}.\n- Composition: ${WEBSITE_TEMPLATES[selection.layoutIndex].layout}.\n- Page rhythm: ${WEBSITE_SECTION_RHYTHMS[selection.rhythmIndex]}.\n- Surface treatment: ${WEBSITE_SURFACES[selection.surfaceIndex]}.\n- Typography: ${WEBSITE_TYPE_STYLES[selection.typeIndex]}.\n- Approved photography: ${orderedImages.join(' | ')}. Use at least two of these as meaningful background or editorial images with readable overlays.`,
  };
}
async function generateCampaign(prompt) {
  const request = model => ({
    model,
    max_tokens: 2600,
    system: 'You are Nitro Ads Strategist, a senior direct-response media buyer and conversion strategist. Build specific, usable campaign launch kits from the supplied facts. Never fabricate proof, results, reviews, or business details.',
    messages: [{ role: 'user', content: prompt }],
  });
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await anthropic.messages.create({ ...request(ADS_MODEL), thinking: { type: 'disabled' } });
      return { text: textOf(result), model: ADS_MODEL };
    } catch (error) {
      try {
        if (ADS_MODEL !== ADS_FALLBACK_MODEL) {
          const result = await anthropic.messages.create(request(ADS_FALLBACK_MODEL));
          return { text: textOf(result), model: ADS_FALLBACK_MODEL };
        }
      } catch (fallbackError) {
        console.error('Anthropic campaign generation failed; using failover:', fallbackError.message);
      }
    }
  }
  return { text: await generateOpenAI(prompt, 3200, request(ADS_FALLBACK_MODEL).system), model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini' };
}
// Generate an image via OpenAI. Tries gpt-image-1 first (can render text), falls back to dall-e-3.
async function genImage(prompt, size) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Image generation is not set up yet.');
  const call = (payload) => fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let r = await call({ model: 'gpt-image-1', prompt, size, n: 1 });
  let j = await r.json().catch(() => ({}));
  if (r.ok && j && j.data && j.data[0] && j.data[0].b64_json) return j.data[0].b64_json;
  const d3 = size === '1536x1024' ? '1792x1024' : size === '1024x1536' ? '1024x1792' : '1024x1024';
  r = await call({ model: 'dall-e-3', prompt, size: d3, n: 1, response_format: 'b64_json' });
  j = await r.json().catch(() => ({}));
  if (r.ok && j && j.data && j.data[0] && j.data[0].b64_json) return j.data[0].b64_json;
  throw new Error((j && j.error && j.error.message) || 'Image generation failed. Please try again.');
}
function ctx(user) {
  return {
    company: clean(user.company?.name || user.companyName || user.onboarding?.data?.companyName || 'the business', 140),
    industry: clean(user.company?.industry || user.onboarding?.data?.industry || 'general', 100),
  };
}
// Pull the HTML document out of a model response even if it adds prose or code fences.
function extractHtml(raw) {
  let t = String(raw || '');
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const start = t.search(/<!DOCTYPE|<html/i);
  if (start >= 0) t = t.slice(start);
  return t.trim();
}
// If a generation was cut off, close any dangling tags so the page still renders.
function repairHtml(h) {
  let t = String(h || '');
  const opens = (t.match(/<style[\s>]/gi) || []).length;
  const closes = (t.match(/<\/style>/gi) || []).length;
  if (opens > closes) t += '\n</style>';
  if (/<body/i.test(t) && !/<\/body>/i.test(t)) t += '\n</body>';
  if (/<html/i.test(t) && !/<\/html>/i.test(t)) t += '\n</html>';
  // Generated sites have no JavaScript, so every CTA must resolve somewhere.
  // A model occasionally emits a placeholder href; send it to the contact
  // section instead of leaving a dead control.
  t = t.replace(/href\s*=\s*(["'])#\1/gi, 'href="#contact"');
  return t;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (!await rateLimit(`workspace:${user.id}`, 30, 60)) { res.status(429).json({ error: 'Please wait a moment before trying again.' }); return; }

  const body = req.body || {};
  const action = clean(body.action, 60).toLowerCase();
  const plan = planFor(user.subscription?.plan);
  const data = workspace(user);
  const creditsLeft = () => plan.aiCredits === null || user.usage.aiUsed < plan.aiCredits;
  const isOwner = String(user.email || '').toLowerCase() === String(process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
  const requireContentCredits = (cost) => isOwner || contentCreditBalance(user) >= cost;

  try {
    // ---- UPLOAD: add a customer's finished image to Content Studio ----
    if (action === 'upload-image') {
      if (data.content.length >= 200) { res.status(403).json({ error: 'Your content library is full. Delete an older item before uploading another.' }); return; }
      const title = clean(body.title, 140) || 'Uploaded image';
      const imageData = String(body.imageData || '');
      const match = imageData.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!match) { res.status(400).json({ error: 'Upload a PNG, JPG, or WebP image.' }); return; }
      const mime = `image/${match[1]}`;
      const raw = match[2].replace(/\s/g, '');
      const bytes = Buffer.from(raw, 'base64');
      if (bytes.length < 100) { res.status(400).json({ error: 'That image file is empty or invalid.' }); return; }
      if (bytes.length > 5 * 1024 * 1024) { res.status(413).json({ error: 'Keep each image under 5 MB.' }); return; }
      const imageId = id('img');
      await kv.set(`customer:img:${imageId}`, JSON.stringify({ data: raw, mime }));
      const item = { id: imageId, type: 'image', topic: title, size: 'Portrait', source: 'upload', mime, createdAt: new Date().toISOString() };
      data.content.unshift(item);
      await saveCustomer(user);
      res.status(201).json({ ok: true, item });
      return;
    }

    // ---- CAROUSEL: group existing Content Studio images without duplicating media ----
    if (action === 'create-carousel-from-images') {
      const imageIds = [...new Set((Array.isArray(body.imageIds) ? body.imageIds : []).map(value => clean(value, 80)).filter(Boolean))].slice(0, 10);
      if (imageIds.length < 2) { res.status(400).json({ error: 'Select at least 2 images for the carousel.' }); return; }
      const slides = imageIds.map(imageId => data.content.find(item => item.id === imageId && item.type === 'image'));
      if (slides.some(item => !item)) { res.status(400).json({ error: 'One or more selected images are no longer available.' }); return; }
      const title = clean(body.title, 140) || 'Instagram carousel';
      const item = {
        id: id('carousel'), type: 'carousel', topic: title,
        caption: clean(body.caption, 2200), ownsSlides: false,
        slides: slides.map((slide, index) => ({ id: slide.id, caption: `Slide ${index + 1}` })),
        source: 'upload', createdAt: new Date().toISOString(),
      };
      data.content.unshift(item);
      await saveCustomer(user);
      res.status(201).json({ ok: true, item });
      return;
    }

    // ---- WEBSITES: generate a real, complete one-page site ----
    if (action === 'generate-website' || action === 'create-website') {
      if (plan.websites !== null && data.websites.length >= plan.websites) {
        res.status(403).json({ error: `Your ${plan.name} plan includes ${plan.websites} website${plan.websites === 1 ? '' : 's'}. Upgrade to add more.` }); return;
      }
      const name = clean(body.name, 100);
      if (!name) { res.status(400).json({ error: 'Give your website a name.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const about = clean(body.about || body.description, 800);
      const industry = clean(body.industry, 120) || ctx(user).industry;
      const audience = clean(body.audience, 500);
      const action = clean(body.primaryAction, 180);
      const contact = clean(body.contact, 300);
      const templateId = clean(body.template, 40).toLowerCase();
      const design = websiteDirection(industry, user, data.websites.slice(0, 20).map(site => site.designSignature), about, templateId);
      const prompt = `Build a polished, conversion-focused one-page website as one self-contained HTML file.

BUSINESS BRIEF
- Name: ${name}
- Industry: ${industry}
- Services, offer, and differentiators: ${about || 'A quality local business serving customers in its market.'}
- Ideal customer and service area: ${audience || 'People looking for a reliable, professional provider.'}
- Primary action visitors should take: ${action || 'Contact the business to get started.'}
- Contact details supplied by the business: ${contact || 'None supplied. Use a Contact us button that links to #contact; do not invent details.'}
- Unique design recipe: ${design.brief}

OUTPUT RULES
- Return only the HTML document, beginning with <!DOCTYPE html> and ending with </body></html>. No markdown.
- Put all CSS in one <style> block. No frameworks, external fonts, or JavaScript. The only permitted external assets are the approved photography URLs in the design recipe.
- Target 700–950 words of visible copy and roughly 3,000–4,200 tokens of compact HTML/CSS. Do not repeat CSS declarations or add unused selectors.
- Keep the page lightweight and fast: no giant SVG path data, base64 assets, canvas, or decorative markup that does not improve the design.
- Write business-specific copy using the brief's actual wording and implications. Avoid generic filler.
- Never invent prices, statistics, years in business, customer counts, reviews, awards, certifications, addresses, phone numbers, emails, or guarantees.

CONTENT INVENTORY — COMPOSE IT IN THE ORDER REQUIRED BY THE UNIQUE DESIGN RECIPE
- Header with brand name, compact navigation, and primary CTA. It may be sticky, floating, vertical, or integrated into the hero according to the recipe.
- Industry-specific hero with a concrete outcome-led headline, supporting copy, two actions, and real approved photography. Do not use a generic dashboard mockup or abstract SVG as the main visual.
- Credibility/value moment using only qualitative claims supported by the brief—no fabricated numbers.
- Services presentation with 3–5 items and useful two-sentence descriptions. It does not have to be a row of identical cards.
- Three specific audience benefits, a simple three-step process, and a human differentiator/about moment.
- Four practical FAQ questions and concise answers based only on the brief.
- Strong final CTA/contact section using supplied details, followed by a complete footer.
- Do not fall back to the conventional hero → logo strip → three cards → three steps layout. Reorder, overlap, alternate, and vary section widths exactly as the recipe directs.

DESIGN QUALITY
- Explicit branding instructions in the BUSINESS BRIEF override every conflicting color, typography, logo, surface, and decoration suggestion in the unique design recipe below. Do not improvise outside an explicitly restricted palette or font system.
- Treat the unique design recipe as a layout specification, not a loose suggestion. Its composition, section rhythm, surface treatment, typography, and image placement must all be visibly present.
- Use at least two approved photos: one must be a large background or full-bleed image and another must appear in a different crop or section. Add a readable solid scrim when text overlays a photo; use a gradient scrim only when the business brief permits gradients.
- Do not use the same repeated three-column card grid for multiple sections. Vary alignment, scale, shape, and placement so the page has a distinctive silhouette.
- Use strong typography hierarchy, generous spacing, layered cards, tasteful shadows, hover states, and one or two restrained decorative details. Use gradients only when the business brief permits them and they fit the requested brand system.
- Responsive at mobile, tablet, and desktop widths. Use semantic HTML, visible focus styles, accessible contrast, descriptive link text, and reduced-motion support.
- Every action must be an <a> with a working href. Use supplied phone/email/booking links when available; otherwise link to an existing section such as #services, #about, #faq, or #contact. Never emit href="#" or a button that does nothing.
- Include a specific <title> and meta description.`;
      const startedAt = Date.now();
      const generated = await generateWebsite(prompt);
      const html = repairHtml(extractHtml(generated.html));
      if (!html || html.length < 600 || !/<body/i.test(html)) { res.status(502).json({ error: 'The site could not be generated. Please try again.' }); return; }
      const siteId = id('site');
      const generationMs = Date.now() - startedAt;
      const website = { id: siteId, name, industry, status: 'ready', url: `/api/site?id=${siteId}`, templateId: design.template.id, templateName: design.template.name, designSignature: design.signature, createdAt: new Date().toISOString(), generationMs };
      data.websites.unshift(website);
      user.usage.websites = data.websites.length;
      user.usage.aiUsed += 1;
      await Promise.all([
        kv.set(`site:${siteId}`, { html, name, owner: user.id, createdAt: website.createdAt }),
        saveCustomer(user),
      ]);
      console.log(JSON.stringify({ level: 'info', msg: 'website_generated', siteId, model: generated.model, generationMs, htmlBytes: Buffer.byteLength(html) }));
      res.status(201).json({ ok: true, website, aiUsed: user.usage.aiUsed }); return;
    }

    // ---- CONTENT: generate a ready-to-post piece ----
    if (action === 'generate-content') {
      const topic = clean(body.topic, 600);
      if (!topic) { res.status(400).json({ error: 'Enter a topic for the content.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const format = clean(body.format, 40) || 'social post';
      const { company } = ctx(user);
      const content = await generate(`Write a polished, useful ${format} for ${company}. Topic: ${topic}. Include a clear hook, a concise body, a helpful call to action, and 3-5 relevant hashtags where appropriate. Do not claim results you cannot prove. Return only the ready-to-post copy.`, 600);
      const item = { id: id('content'), topic, format, text: clean(content, 5000), createdAt: new Date().toISOString() };
      data.content.unshift(item); data.content = data.content.slice(0, plan.id === 'free' ? 10 : 100);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(201).json({ ok: true, content: item, aiUsed: user.usage.aiUsed }); return;
    }

    // ---- CONTENT: generate an AI image / visual ----
    if (action === 'generate-image') {
      const promptText = clean(body.prompt, 1000);
      if (!promptText) { res.status(400).json({ error: 'Describe the image you want.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      if (!requireContentCredits(1)) { res.status(402).json({ error: 'This image uses 1 Content credit. Add credits to continue.', needsContentCredits: true }); return; }
      const sizeMap = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
      const size = sizeMap[clean(body.size, 20).toLowerCase()] || '1024x1024';
      const { company, industry } = ctx(user);
      const fullPrompt = `${promptText}. Polished, professional marketing visual for ${company} (industry: ${industry}). Modern, clean, high quality, on-brand. Only include text in the image if the request asks for it.`.slice(0, 3800);
      const b64 = await genImage(fullPrompt, size);
      const imgId = id('img');
      try { await kv.set(`customer:img:${imgId}`, b64, { ex: 60 * 60 * 24 * 120 }); } catch {}
      const item = { id: imgId, type: 'image', topic: promptText.slice(0, 120), prompt: promptText, format: 'image', size, createdAt: new Date().toISOString() };
      data.content.unshift(item); data.content = data.content.slice(0, plan.id === 'free' ? 10 : 100);
      user.usage.aiUsed += 1;
      if (!isOwner) spendContentCredits(user, 1); else migrateContentCredits(user);
      await saveCustomer(user); res.status(201).json({ ok: true, content: item, dataUrl: `data:image/png;base64,${b64}`, aiUsed: user.usage.aiUsed, contentCredits: contentCreditBalance(user) }); return;
    }

    // ---- CONTENT: one-click multi-slide carousel post (image per slide) ----
    if (action === 'generate-carousel') {
      const topic = clean(body.prompt || body.topic, 1000);
      if (!topic) { res.status(400).json({ error: 'Describe what the carousel is about.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      if (!requireContentCredits(2)) { res.status(402).json({ error: 'A complete carousel uses 2 Content credits. Add credits to continue.', needsContentCredits: true }); return; }
      if (!process.env.OPENAI_API_KEY) { res.status(400).json({ error: 'Image generation is not set up yet.' }); return; }
      let count = parseInt(clean(body.slides, 4), 10); if (!(count >= 2 && count <= 8)) count = 5;
      const sizeMapC = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
      const size = sizeMapC[clean(body.size, 20).toLowerCase()] || '1024x1024';
      const { company, industry } = ctx(user);
      // 1. Plan the slides (image description + caption for each)
      const planRaw = await generate(`Plan an Instagram carousel of exactly ${count} slides for ${company} (industry: ${industry}). Topic: ${topic}. For each slide give: "image" = a vivid, specific art-direction prompt for an AI image generator (a clean, modern, on-brand marketing visual; mention composition and colors; avoid paragraphs of text in the image) and "caption" = a short punchy caption under 120 characters. Return ONLY a JSON array of exactly ${count} objects: [{"image":"...","caption":"..."}]. No markdown, no commentary.`, 1600, FAST_MODEL);
      let slidePlan = null;
      try { const m = planRaw.match(/\[[\s\S]*\]/); slidePlan = JSON.parse(m ? m[0] : planRaw); } catch { slidePlan = null; }
      if (!Array.isArray(slidePlan) || !slidePlan.length) {
        slidePlan = Array.from({ length: count }, (_, i) => ({ image: `${topic}. Slide ${i + 1} of ${count}, professional marketing visual for ${company}.`, caption: `${topic} — ${i + 1}/${count}` }));
      }
      slidePlan = slidePlan.slice(0, count);
      // 2. Generate all slide images in parallel
      const results = await Promise.all(slidePlan.map(async (sl) => {
        const p = `${clean(sl && sl.image, 900)}. Polished professional marketing visual for ${company}. Modern, clean, high quality, on-brand.`.slice(0, 3800);
        try { const b64 = await genImage(p, size); return { b64, caption: clean(sl && sl.caption, 200) }; }
        catch { return null; }
      }));
      const slides = [];
      for (const rr of results) {
        if (!rr) continue;
        const sid = id('img');
        try { await kv.set(`customer:img:${sid}`, rr.b64, { ex: 60 * 60 * 24 * 120 }); } catch {}
        slides.push({ id: sid, caption: rr.caption });
      }
      if (!slides.length) { res.status(500).json({ error: 'Could not generate the carousel. Please try again.' }); return; }
      const item = { id: id('content'), type: 'carousel', topic: topic.slice(0, 120), prompt: topic, format: 'carousel', size, slides, createdAt: new Date().toISOString() };
      data.content.unshift(item); data.content = data.content.slice(0, plan.id === 'free' ? 10 : 100);
      user.usage.aiUsed += 1;
      if (!isOwner) spendContentCredits(user, 2); else migrateContentCredits(user);
      await saveCustomer(user); res.status(201).json({ ok: true, content: item, aiUsed: user.usage.aiUsed, contentCredits: contentCreditBalance(user) }); return;
    }

    // ---- ASSISTANT ----
    if (action === 'ask-assistant') {
      const prompt = clean(body.prompt, 1200);
      if (!prompt) { res.status(400).json({ error: 'Ask Nitro a question first.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const { company, industry } = ctx(user);
      const snapshot = operatorSnapshot(user);
      const priorities = operatorPriorities(snapshot);
      const context = `Company: ${company}. Industry: ${industry}. Goals: ${(user.onboarding?.data?.goals || []).join(', ') || 'Not set'}.
Verified Nitro workspace snapshot: ${JSON.stringify(snapshot)}.
Current deterministic priorities: ${JSON.stringify(priorities.map(item => ({ title: item.title, detail: item.detail, agent: item.agent })))}.`;
      // Optional short conversation history from the client for coherent multi-turn threads.
      let transcript = '';
      if (Array.isArray(body.history)) {
        transcript = body.history.slice(-6)
          .map(m => `${m && m.role === 'assistant' ? 'You' : 'User'}: ${clean(m && m.text, 700)}`)
          .filter(Boolean).join('\n');
      }
      const answer = await generate(`You are Nitro Operator, the command center for a small business. You coordinate specialized Site, Content, Publisher, Outreach, and Growth agents. ${context}

Rules:
- Treat the verified snapshot as the source of truth. Never invent traffic, revenue, ad spend, reach, customers, replies, integrations, or completed work.
- Never claim you sent, published, paused, changed, or created anything unless the supplied context explicitly confirms it.
- If the user asks for an action, explain the exact next step and tell them which Nitro agent or workspace will handle it.
- Distinguish clearly between recommendations and completed actions.

Style: sound like a calm, decisive operator. Get straight to the point in under 180 words. Use light Markdown only where it helps — bold key facts and short bullet lists. No filler and no restating the question.${transcript ? `\n\nConversation so far:\n${transcript}` : ''}\n\nUser: ${prompt}`, 500, FAST_MODEL);
      const suggestedAction = inferOperatorAction(prompt);
      const entry = { id: id('chat'), prompt, answer: clean(answer, 6000), agent: operatorAgent(prompt), suggestedAction, snapshot, createdAt: new Date().toISOString() };
      data.assistant.unshift(entry); data.assistant = data.assistant.slice(0, 12);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(200).json({ ok: true, entry, aiUsed: user.usage.aiUsed }); return;
    }

    // ---- SOCIAL: schedule a post for a real date/time ----
    if (action === 'schedule-post' || action === 'create-social-draft') {
      if (plan.id === 'free') { res.status(403).json({ error: 'Social scheduling starts on the Starter plan.' }); return; }
      const text = clean(body.text, 3000);
      if (!text) { res.status(400).json({ error: 'Enter post copy first.' }); return; }
      let when = clean(body.scheduledFor, 40);
      let ts = when ? Date.parse(when) : NaN;
      const requestedMedia = clean(body.mediaType, 20).toLowerCase();
      const mediaType = requestedMedia === 'reel' || requestedMedia === 'video' ? 'video' : requestedMedia === 'text' ? 'text' : 'image';
      const mediaUrl = clean(body.mediaUrl || body.imageUrl, 600) || null;
      if (mediaUrl) {
        let parsed;
        try { parsed = new URL(mediaUrl); } catch {}
        if (!parsed || parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'Use a public HTTPS media URL that the selected platforms can access.' }); return;
        }
      }
      const requestedPlatform = clean(body.platform, 30).toLowerCase() || 'instagram';
      const allowed = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube'];
      if (requestedPlatform !== 'all' && !allowed.includes(requestedPlatform)) { res.status(400).json({ error: 'Choose a supported social platform.' }); return; }
      const connected = allowed.filter(platform => platform === 'instagram'
        ? Boolean(user.meta?.token && user.meta?.igUserId)
        : Boolean(user.socialConnections?.[platform]?.connected && user.socialConnections?.[platform]?.accessToken));
      const compatible = connected.filter(platform => mediaType === 'video' || (mediaType === 'image' && platform !== 'youtube') || (mediaType === 'text' && ['facebook', 'linkedin'].includes(platform)));
      const publicReady = compatible.filter(platform => platform !== 'tiktok' || user.socialConnections?.tiktok?.publicPublishingApproved === true);
      const platforms = requestedPlatform === 'all' ? publicReady : [requestedPlatform];
      if (!platforms.length) { res.status(400).json({ error: 'Connect at least one social account before scheduling.' }); return; }
      const missing = platforms.filter(platform => !connected.includes(platform));
      if (missing.length) { res.status(400).json({ error: `Connect ${missing.join(', ')} before scheduling to it.` }); return; }
      if (platforms.includes('tiktok') && user.socialConnections?.tiktok?.publicPublishingApproved !== true && clean(body.privacyLevel, 40) !== 'SELF_ONLY') {
        res.status(400).json({ error: 'TikTok public auto-publishing is awaiting audit approval. Choose Private for a TikTok-only test, or choose All public-ready platforms.' }); return;
      }
      const mediaRequired = platforms.filter(platform => ['instagram', 'tiktok', 'youtube'].includes(platform));
      if (mediaRequired.length && !mediaUrl) { res.status(400).json({ error: `${mediaRequired.join(', ')} requires a public image or video URL.` }); return; }
      if (platforms.includes('youtube') && mediaType !== 'video') { res.status(400).json({ error: 'YouTube scheduling requires a video. Choose Video or schedule the other channels separately.' }); return; }
      if (platforms.includes('tiktok') && !['image', 'video'].includes(mediaType)) { res.status(400).json({ error: 'TikTok requires an image or video.' }); return; }
      if (platforms.includes('instagram') && !['image', 'video'].includes(mediaType)) { res.status(400).json({ error: 'Instagram requires an image or video.' }); return; }
      const groupId = id('social_group');
      const drafts = platforms.map(platform => ({
        id: id('social'), groupId, text, title: clean(body.title, 100), platform,
        privacyLevel: clean(body.privacyLevel, 40), mediaType, mediaUrl,
        imageUrl: mediaType === 'image' ? mediaUrl : null,
        scheduledFor: isNaN(ts) ? null : new Date(ts).toISOString(),
        status: isNaN(ts) ? 'draft' : 'scheduled', createdAt: new Date().toISOString(),
      }));
      data.socialDrafts.unshift(...drafts);
      await saveCustomer(user);
      res.status(201).json({ ok: true, draft: drafts[0], drafts }); return;
    }

    if (action === 'update-social') {
      if (plan.id === 'free') { res.status(403).json({ error: 'Social scheduling starts on the Starter plan.' }); return; }
      const socialId = clean(body.id, 80);
      const draft = data.socialDrafts.find(item => item.id === socialId);
      if (!draft) { res.status(404).json({ error: 'That scheduled post was not found.' }); return; }
      if (draft.status === 'published' || draft.status === 'publishing') { res.status(409).json({ error: 'Published or currently publishing posts cannot be rescheduled.' }); return; }
      const text = clean(body.text, 3000);
      const requestedMedia = clean(body.mediaType, 20).toLowerCase();
      const mediaType = requestedMedia === 'reel' || requestedMedia === 'video' ? 'video' : requestedMedia === 'text' ? 'text' : 'image';
      const mediaUrl = clean(body.mediaUrl || body.imageUrl, 600) || null;
      const ts = Date.parse(clean(body.scheduledFor, 40));
      if (!text) { res.status(400).json({ error: 'Enter post copy first.' }); return; }
      if (isNaN(ts)) { res.status(400).json({ error: 'Choose a valid publishing date and time.' }); return; }
      if (draft.platform === 'youtube' && mediaType !== 'video') { res.status(400).json({ error: 'YouTube requires a video.' }); return; }
      if (['instagram', 'tiktok'].includes(draft.platform) && !['image', 'video'].includes(mediaType)) { res.status(400).json({ error: `${draft.platform} requires an image or video.` }); return; }
      let parsed;
      try { if (mediaUrl) parsed = new URL(mediaUrl); } catch {}
      if (mediaType !== 'text' && (!parsed || parsed.protocol !== 'https:')) {
        res.status(400).json({ error: 'Use a public HTTPS media URL that the selected platform can access.' }); return;
      }
      draft.text = text;
      draft.mediaType = mediaType;
      draft.mediaUrl = mediaUrl;
      draft.imageUrl = mediaType === 'image' ? mediaUrl : null;
      draft.scheduledFor = new Date(ts).toISOString();
      draft.status = 'scheduled';
      draft.error = null;
      draft.updatedAt = new Date().toISOString();
      await saveCustomer(user);
      res.status(200).json({ ok: true, draft }); return;
    }

    if (action === 'cancel-social-schedule') {
      const socialId = clean(body.id, 80);
      const draft = data.socialDrafts.find(item => item.id === socialId);
      if (!draft) { res.status(404).json({ error: 'That scheduled post was not found.' }); return; }
      if (draft.status !== 'scheduled' && draft.status !== 'failed') {
        res.status(409).json({ error: 'Only scheduled or failed posts can be moved back to drafts.' }); return;
      }
      draft.status = 'draft';
      draft.scheduledFor = null;
      draft.error = null;
      draft.updatedAt = new Date().toISOString();
      await saveCustomer(user);
      res.status(200).json({ ok: true, draft }); return;
    }

    // ---- ADS: build a real, detailed campaign plan ----
    if (action === 'build-campaign' || action === 'create-campaign') {
      if (!['growth', 'pro', 'scale'].includes(plan.id)) { res.status(403).json({ error: 'Ad campaign management starts on the Growth plan.' }); return; }
      const name = clean(body.name, 140);
      if (!name) { res.status(400).json({ error: 'Give this campaign a name.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const objective = clean(body.objective, 500) || 'get more leads';
      const budget = clean(body.budget, 40) || 'a small monthly budget';
      const offer = clean(body.offer, 700) || 'the business offer';
      const platform = clean(body.platform, 80) || 'Nitro recommends';
      const audience = clean(body.audience, 700) || 'the business’s ideal customer';
      const location = clean(body.location, 160) || 'the business service area';
      const destination = clean(body.destination, 600) || 'the most relevant website or landing page';
      const notes = clean(body.notes, 700);
      const { company, industry } = ctx(user);
      const generated = await generateCampaign(`Build a concrete, ready-to-launch paid advertising launch kit for this business.

Business: ${company} (${industry})
Campaign name: ${name}
Offer: ${offer}
Objective: ${objective}
Preferred channel: ${platform}
Ideal customer: ${audience}
Target location: ${location}
Budget: ${budget}
Destination: ${destination}
Additional context: ${notes || 'None supplied'}

Write a sharp, skimmable plan in Markdown with exactly these sections:
## Campaign decision
Choose the best channel and campaign type. Explain the choice in 2–3 sentences.
## Conversion path
Map click → landing page → primary action. Flag any missing piece without inventing it.
## Audience and targeting
Give specific location, intent, demographic, interest, keyword, negative-keyword, or exclusion guidance appropriate to the chosen platform.
## Budget and bidding
Turn the stated budget into a daily amount, recommend a starting bid strategy, and explain how to control waste. Do not promise results.
## Messaging angles
Give three meaningfully different angles, each with the customer pain, promise, proof needed, and CTA.
## Ready-to-paste ads
For Google: provide 12 headlines under 30 characters, 4 descriptions under 90 characters, sitelink ideas, and a keyword starter list. For Meta/Instagram: provide 3 primary-text variants, 5 headlines, CTAs, and placements. If multiple platforms are recommended, include usable assets for each.
## Creative brief
Describe 3 distinct image or video concepts with hook, opening frame, visual progression, on-screen message, and CTA.
## Tracking
List conversion events, URL/UTM setup, and the exact signals to review after launch.
## Launch checklist
Give an ordered checklist from account setup through final QA.
## First optimization cycle
Explain what to inspect after enough traffic arrives, what not to change too early, and how to decide the first test.

Be specific to the supplied business and offer. Do not invent performance numbers, testimonials, discounts, guarantees, or contact details.`, 2600);
      const campaign = {
        id: id('campaign'), name, offer, objective, platform, audience, location, budget,
        destination, notes, status: 'planned', plan: clean(generated.text, 18000),
        model: generated.model, createdAt: new Date().toISOString(),
      };
      data.campaigns.unshift(campaign);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(201).json({ ok: true, campaign, aiUsed: user.usage.aiUsed }); return;
    }

    if (action === 'update-campaign-status') {
      const campaignId = clean(body.id, 80);
      const status = clean(body.status, 20).toLowerCase();
      if (!['planned', 'ready', 'active', 'paused'].includes(status)) { res.status(400).json({ error: 'Choose a valid campaign status.' }); return; }
      const campaign = data.campaigns.find(item => item.id === campaignId);
      if (!campaign) { res.status(404).json({ error: 'Campaign not found.' }); return; }
      campaign.status = status;
      campaign.updatedAt = new Date().toISOString();
      await saveCustomer(user);
      res.status(200).json({ ok: true, campaign }); return;
    }

    // ---- DELETE items (frees up plan slots / lets users start over) ----
    if (action === 'delete-website') {
      const wid = clean(body.id, 80);
      const before = data.websites.length;
      data.websites = data.websites.filter(w => w.id !== wid);
      if (data.websites.length !== before) { try { await kv.del(`site:${wid}`); } catch {} }
      user.usage.websites = data.websites.length;
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }
    if (action === 'delete-content') {
      const cid = clean(body.id, 80);
      const gone = data.content.find(c => c.id === cid);
      data.content = data.content.filter(c => c.id !== cid);
      try { await kv.del(`customer:img:${cid}`); } catch {}
      if (gone && gone.ownsSlides !== false && Array.isArray(gone.slides)) { for (const s of gone.slides) { try { await kv.del(`customer:img:${s.id}`); } catch {} } }
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }
    if (action === 'update-content-caption') {
      const cid = clean(body.id, 80);
      const item = data.content.find(c => c.id === cid);
      if (!item || !['image', 'carousel', 'video'].includes(item.type)) {
        res.status(404).json({ error: 'That content was not found.' }); return;
      }
      item.caption = clean(body.caption, 2200);
      await saveCustomer(user);
      res.status(200).json({ ok: true, item }); return;
    }
    if (action === 'delete-campaign') {
      const cid = clean(body.id, 80);
      data.campaigns = data.campaigns.filter(c => c.id !== cid);
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }
    if (action === 'delete-social') {
      const sid = clean(body.id, 80);
      data.socialDrafts = data.socialDrafts.filter(s => s.id !== sid);
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }

    // ---- SOCIAL: publish a generated image or carousel straight to Instagram ----
    if (action === 'publish-instagram') {
      const cid = clean(body.id, 80);
      const item = data.content.find(c => c.id === cid);
      if (!item) { res.status(404).json({ error: 'That content was not found.' }); return; }
      if (item.postedToInstagram) { res.status(409).json({ error: 'This content has already been posted to Instagram.' }); return; }
      if (!user.meta || !user.meta.token || !user.meta.igUserId) {
        res.status(400).json({ error: 'Connect your Instagram first (Social tab).' }); return;
      }
      const base = requestOrigin(req) || 'https://nitrooutreach.com';
      const pub = (imgId) => `${base}/api/pub-image?id=${encodeURIComponent(imgId)}`;
      const caption = clean(body.caption, 2200) || item.caption || item.topic || '';
      try {
        let mediaId;
        if (item.type === 'video') {
          mediaId = await publishReel(user.meta.igUserId, user.meta.token, caption, item.mediaUrl);
        } else if (item.type === 'carousel') {
          const urls = (item.slides || []).map(s => pub(s.id));
          mediaId = await publishCarousel(user.meta.igUserId, user.meta.token, caption, urls);
        } else if (item.type === 'image') {
          mediaId = await publishImage(user.meta.igUserId, user.meta.token, caption, pub(item.id));
        } else {
          res.status(400).json({ error: 'Only images, carousels, and Reels can be posted to Instagram.' }); return;
        }
        item.postedToInstagram = { mediaId, at: new Date().toISOString() };
        await saveCustomer(user);
        res.status(200).json({ ok: true, mediaId });
      } catch (e) {
        console.error('Instagram publish error:', e.message);
        await notifyBestEffort({ title: 'Instagram post failed', message: `${user.email}: ${e.message}`, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com/app#content' });
        res.status(500).json({ error: e.message || 'Posting to Instagram failed. Please try again.' });
      }
      return;
    }

    // ---- MESSAGING: log a sent/scheduled email or SMS the customer records ----
    if (action === 'log-message') {
      const channel = clean(body.channel, 10).toLowerCase() === 'sms' ? 'sms' : 'email';
      const to = clean(body.to, 200);
      const bodyText = clean(body.body, channel === 'sms' ? 1200 : 8000);
      if (!to) { res.status(400).json({ error: 'Add a recipient first.' }); return; }
      if (!bodyText) { res.status(400).json({ error: 'Write a message first.' }); return; }
      const entry = {
        id: id('msg'), channel, to,
        subject: channel === 'email' ? (clean(body.subject, 240) || '(no subject)') : '',
        body: bodyText,
        status: clean(body.status, 20).toLowerCase() === 'scheduled' ? 'scheduled' : 'sent',
        createdAt: new Date().toISOString(),
      };
      data.messages.unshift(entry); data.messages = data.messages.slice(0, 200);
      await saveCustomer(user); res.status(200).json({ ok: true, entry }); return;
    }
    if (action === 'delete-message') {
      const mid = clean(body.id, 80);
      data.messages = data.messages.filter(m => m.id !== mid);
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }
    // ---- MESSAGING: connect an email/texting account so sends auto-log ----
    if (action === 'connect-messaging') {
      const channel = clean(body.channel, 10).toLowerCase() === 'sms' ? 'sms' : 'email';
      data.connections[channel] = channel === 'email'
        ? { connected: true, from: clean(body.from, 200), connectedAt: new Date().toISOString() }
        : { connected: true, number: clean(body.number, 40), connectedAt: new Date().toISOString() };
      // One durable webhook token per account so a connected provider can auto-log sends & replies.
      if (!data.connections.hookToken) {
        const token = randomBytes(24).toString('base64url');
        data.connections.hookToken = token;
        try { await kv.set('customer:msghook:' + token, user.id); } catch {}
      }
      await saveCustomer(user); res.status(200).json({ ok: true, connections: data.connections }); return;
    }
    if (action === 'disconnect-messaging') {
      const channel = clean(body.channel, 10).toLowerCase() === 'sms' ? 'sms' : 'email';
      data.connections[channel] = { connected: false };
      await saveCustomer(user); res.status(200).json({ ok: true, connections: data.connections }); return;
    }

    res.status(400).json({ error: 'Unknown workspace action' });
  } catch (error) {
    console.error('Customer workspace error:', error.message);
    if (/generate|create-(website|campaign|content)/.test(action)) {
      await notifyBestEffort({ title: 'Nitro generation failed', message: `${user.email} · ${action}: ${error.message}`, priority: 'high', tags: 'warning,robot_face', click: 'https://nitrooutreach.com/app' });
    }
    res.status(500).json({ error: 'That action could not be completed. Please try again.' });
  }
}
