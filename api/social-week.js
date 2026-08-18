import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';
import { kv } from '@vercel/kv';

export const config = { maxDuration: 300 };

const ANGLES = [
  'contrarian opinion', 'quick practical tip', 'pain-point observation', 'before-versus-after',
  'mini story', 'feature spotlight', 'myth versus reality', 'simple checklist',
  'customer point of view', 'founder-style thought', 'problem/solution', 'bold one-line idea',
];
const VISUALS = [
  'editorial magazine cover with oversized type and lots of negative space',
  'photography-led composition with one strong subject and tiny supporting type',
  'high-contrast typographic poster with no cards or dashboard UI',
  'split-screen comparison with asymmetric text placement',
  'minimal product-ad layout with one focal object and sparse copy',
  'collage layout with layered paper-like crops and small annotations',
  'bold geometric composition with large cropped lettering',
  'clean infographic-style composition with one diagram and little text',
  'cinematic dark composition with a single luminous focal element',
  'bright spacious layout with a tiny headline and large visual field',
  'retro print-ad composition with restrained texture and unusual alignment',
  'luxury monochrome composition with elegant type and one dramatic image',
];
const CTAS = [
  'Ask a short question', 'Invite the reader to try one feature', 'Use a direct Start free CTA',
  'End with a useful takeaway and no sales CTA', 'Invite a reply', 'Point to nitrooutreach.com naturally',
];

function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function cleanDate(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) && ts > Date.now() - 60_000 ? new Date(ts).toISOString() : '';
}
function pick(arr, used = new Set()) {
  const options = arr.filter(x => !used.has(x));
  const pool = options.length ? options : arr;
  const value = pool[Math.floor(Math.random() * pool.length)];
  used.add(value);
  return value;
}
function businessContext(user) {
  const o = user.onboarding?.data || {};
  return {
    company: String(o.companyName || o.businessName || user.company || 'Nitro Outreach').slice(0, 120),
    industry: String(o.industry || user.industry || 'small-business marketing software').slice(0, 120),
    description: String(o.description || o.businessDescription || 'an all-in-one marketing workspace for websites, content, social publishing, outreach, and analytics').slice(0, 500),
  };
}
async function generateCopy(prompt) {
  if (!process.env.OPENAI_API_KEY) return '';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You write distinctive social content for real small businesses. Avoid generic AI marketing language and repetitive structures. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 2600,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI text HTTP ${response.status}`);
  return String(data?.choices?.[0]?.message?.content || '').trim();
}
function retryDelayFromMessage(message, attempt) {
  const match = String(message || '').match(/try again in\s+(\d+(?:\.\d+)?)s/i);
  if (match) return Math.max(3000, Math.ceil(Number(match[1]) * 1000) + 1500);
  return Math.min(18000, 4500 * (attempt + 1));
}
async function generateImage(prompt, attempt = 0) {
  if (!process.env.OPENAI_API_KEY) return '';
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1024' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI image HTTP ${response.status}`;
    const rateLimited = response.status === 429 || /rate limit/i.test(message);
    if (rateLimited && attempt < 3) {
      await sleep(retryDelayFromMessage(message, attempt));
      return generateImage(prompt, attempt + 1);
    }
    throw new Error(message);
  }
  return String(data?.data?.[0]?.b64_json || '');
}
function fallbackPost(company, index, angle, cta) {
  const hooks = [
    `${company} should make the next marketing move easier, not add another tab.`,
    `Consistency gets easier when the work lives in one place.`,
    `A good marketing system removes decisions you should not have to make twice.`,
    `The goal is not more tools. It is fewer dropped follow-ups.`,
    `One useful idea should be able to travel further than one post.`,
    `Your calendar should tell you what is happening before you have to remember it.`,
    `Marketing feels lighter when creation, publishing, and results connect.`,
  ];
  return { title: hooks[index].slice(0, 80), text: `${hooks[index]}\n\n${cta === 'Point to nitrooutreach.com naturally' || cta === 'Use a direct Start free CTA' ? 'Start free at nitrooutreach.com\n\n' : ''}#smallbusiness #marketing #nitrooutreach` };
}
function parsePlannedPosts(raw) {
  if (!raw) return [];
  const candidates = [raw];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.posts)) return parsed.posts;
    } catch {}
  }
  return [];
}
async function createPostImage(post, recipe, company, industry, index) {
  const imagePrompt = `${String(post.imagePrompt || '').slice(0,1200)}\nBrand context: ${company}, ${industry}. Visual recipe: ${recipe.visual}. IMPORTANT: do not imitate a previous Nitro template. Change composition, scale, text placement, background treatment, focal subject, and typography from other posts in this batch. Square social graphic, polished and publishable.`;
  try {
    const b64 = await generateImage(imagePrompt);
    if (b64) {
      const imgId = id('img');
      await kv.set(`customer:img:${imgId}`, b64, { ex: 60 * 60 * 24 * 120 });
      return { ...post, mediaUrl: `https://nitrooutreach.com/api/pub-image?id=${encodeURIComponent(imgId)}`, visualSignature: recipe.visual, freshImage: true };
    }
  } catch (error) {
    console.error('social week image generation failed:', index, error.message);
  }
  return {
    ...post,
    mediaUrl: `https://nitrooutreach.com/social/aug-2026/0${(index % 6) + 1}-${['one-workspace','website','content','social','outreach','start-free'][index % 6]}.jpg`,
    visualSignature: recipe.visual,
    freshImage: false,
  };
}
async function buildWeek(user) {
  const { company, industry, description } = businessContext(user);
  const angleUsed = new Set(), visualUsed = new Set(), ctaUsed = new Set();
  const recipes = Array.from({ length: 7 }, () => ({ angle: pick(ANGLES, angleUsed), visual: pick(VISUALS, visualUsed), cta: pick(CTAS, ctaUsed) }));
  const recent = (user.workspace?.socialDrafts || []).filter(x => x?.autoWeek).slice(0, 14).map(x => `${x.title || ''} ${x.text || ''}`.slice(0, 240));
  const prompt = `Create exactly 7 genuinely different social posts for ${company}, a ${industry} business. Business description: ${description}.\n\nEach post must follow its assigned recipe below and must not reuse the same opening pattern, sentence rhythm, structure, CTA, or core idea. Do not produce seven variations of one ad. Avoid generic phrases like game changer, unlock, level up, revolutionize, are you tired of, here's the truth, and in today's fast-paced world.\n\nRECIPES:\n${recipes.map((r,i)=>`${i+1}. Angle: ${r.angle}. CTA: ${r.cta}. Visual direction: ${r.visual}.`).join('\n')}\n\nRECENT POSTS TO AVOID COPYING:\n${recent.length ? recent.join('\n---\n') : 'None'}\n\nReturn ONLY valid JSON in this exact shape: {"posts":[{"title":"short calendar title","text":"ready-to-post caption with 0-4 relevant hashtags","imagePrompt":"specific visual prompt"}]}. The posts array must contain exactly 7 objects. The imagePrompt must visibly obey that post's assigned visual direction and should use no more than 8 words of readable text in the image. Make every image composition obviously different from every other one.`;
  let planned = [];
  try {
    planned = parsePlannedPosts(await generateCopy(prompt)).slice(0, 7);
  } catch (error) {
    console.error('social week copy generation failed:', error.message);
  }
  while (planned.length < 7) {
    const i = planned.length;
    planned.push({ ...fallbackPost(company, i, recipes[i].angle, recipes[i].cta), imagePrompt: `${recipes[i].visual}. Professional social post for ${company}. ${recipes[i].angle}. Distinct composition, no dashboard mockup, no repeated card grid.` });
  }

  // Generate in small groups instead of firing seven image requests at once.
  // This keeps Nitro under provider image-rate limits while still finishing quickly.
  const generated = new Array(7);
  for (let start = 0; start < planned.length; start += 2) {
    const batch = planned.slice(start, start + 2);
    const results = await Promise.all(batch.map((post, offset) => createPostImage(post, recipes[start + offset], company, industry, start + offset)));
    results.forEach((result, offset) => { generated[start + offset] = result; });
    if (start + 2 < planned.length) await sleep(1800);
  }
  return generated;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['POST', 'DELETE'].includes(req.method)) { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }

  user.workspace = user.workspace || {};
  user.workspace.socialDrafts = Array.isArray(user.workspace.socialDrafts) ? user.workspace.socialDrafts : [];

  if (req.method === 'DELETE') {
    const now = Date.now();
    const requestedBatch = String(req.body?.batchId || '').trim();
    const candidates = user.workspace.socialDrafts.filter(item => item?.autoWeek === true && item?.status === 'scheduled' && Date.parse(item?.scheduledFor || 0) > now);
    let batchId = requestedBatch;
    if (!batchId && candidates.length) batchId = [...candidates].sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0))[0]?.batchId || '';
    if (!batchId) { res.status(200).json({ ok: true, removed: 0, message: 'No generated week to undo.' }); return; }
    const before = user.workspace.socialDrafts.length;
    user.workspace.socialDrafts = user.workspace.socialDrafts.filter(item => !(item?.autoWeek === true && item?.batchId === batchId && item?.status === 'scheduled' && Date.parse(item?.scheduledFor || 0) > now));
    const removed = before - user.workspace.socialDrafts.length;
    if (removed) await saveCustomer(user);
    res.status(200).json({ ok: true, removed, batchId }); return;
  }

  const plan = planFor(user.subscription?.plan);
  if (plan.id === 'free') { res.status(403).json({ error: 'Social scheduling starts on the Starter plan.' }); return; }
  const schedule = Array.isArray(req.body?.schedule) ? req.body.schedule.map(cleanDate).filter(Boolean).slice(0, 7) : [];
  if (schedule.length !== 7) { res.status(400).json({ error: 'Nitro needs seven valid schedule times.' }); return; }

  const connected = [];
  if (user.meta?.token && user.meta?.igUserId) connected.push('instagram');
  for (const platform of ['facebook','linkedin','tiktok']) {
    const c = user.socialConnections?.[platform];
    if (!c?.connected) continue;
    if (platform === 'tiktok' && c.publicPublishingApproved !== true) continue;
    connected.push(platform);
  }
  if (!connected.length) { res.status(400).json({ error: 'Connect at least one public-ready social account first.' }); return; }

  const now = Date.now();
  user.workspace.socialDrafts = user.workspace.socialDrafts.filter(item => !(item.autoWeek === true && item.status === 'scheduled' && Date.parse(item.scheduledFor || 0) > now));

  const posts = await buildWeek(user);
  const batchId = id('auto_week');
  const drafts = [];
  posts.forEach((post, index) => {
    const groupId = id(`week_${index + 1}`);
    for (const platform of connected) {
      drafts.push({
        id: id('social'), groupId, batchId, autoWeek: true,
        title: String(post.title || '').slice(0, 120), text: String(post.text || '').slice(0, 3000), platform,
        mediaType: 'image', mediaUrl: post.mediaUrl, imageUrl: post.mediaUrl,
        visualSignature: post.visualSignature || '', freshImage: post.freshImage === true,
        scheduledFor: schedule[index], status: 'scheduled', privacyLevel: 'PUBLIC_TO_EVERYONE',
        createdAt: new Date().toISOString(),
      });
    }
  });
  user.workspace.socialDrafts.unshift(...drafts);
  await saveCustomer(user);
  const freshImages = posts.filter(post => post?.freshImage).length;
  res.status(201).json({ ok: true, batchId, days: 7, platformCount: connected.length, platforms: connected, jobs: drafts.length, generatedFresh: true, freshImages });
}
