import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { currentCustomer, sameOrigin, saveCustomer, rateLimit } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';
import { kv } from '@vercel/kv';

export const config = { maxDuration: 60 };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001';
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
async function generate(prompt, maxTokens = 700, model = MODEL) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI generation is not configured yet. Please try again later.');
  const result = await anthropic.messages.create({ model, max_tokens: maxTokens, temperature: 0.6, messages: [{ role: 'user', content: prompt }] });
  return textOf(result);
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

  try {
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
      const prompt = `You are an expert web designer. Build a COMPLETE, modern, responsive one-page marketing website as a single HTML file for this business.

Business name: ${name}
Industry: ${industry}
What they do / details: ${about || 'A local business that wants more customers.'}

Requirements:
- Return ONLY the HTML document, starting with <!DOCTYPE html>. No explanation, no markdown fences.
- Everything inline in ONE file: put all CSS inside a <style> tag in the head. No external files, no frameworks, no JS required.
- Sections: a sticky header with the business name + nav, a hero with a strong headline and a call-to-action button, a services/offer section (3-4 items), an about section, a simple contact section with a placeholder email/phone, and a footer.
- Clean, professional, mobile-responsive design with a LIGHT, readable background (light or white sections with dark text). Good typography, spacing, and hover states. A tasteful accent color that fits the industry.
- Keep the CSS compact so the whole document fits in one response and every tag is properly closed. The page MUST end with </body></html>.
- Use realistic, specific copy written for this business (not lorem ipsum). Do not invent fake reviews, awards, or statistics.`;
      const html = repairHtml(extractHtml(await generate(prompt, 8000)));
      if (!html || html.length < 600 || !/<body/i.test(html)) { res.status(502).json({ error: 'The site could not be generated. Please try again.' }); return; }
      const siteId = id('site');
      const website = { id: siteId, name, industry, status: 'ready', url: `/api/site?id=${siteId}`, createdAt: new Date().toISOString() };
      data.websites.unshift(website);
      user.usage.websites = data.websites.length;
      user.usage.aiUsed += 1;
      await kv.set(`site:${siteId}`, { html, name, owner: user.id, createdAt: website.createdAt });
      await saveCustomer(user);
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
      await saveCustomer(user); res.status(201).json({ ok: true, content: item, dataUrl: `data:image/png;base64,${b64}`, aiUsed: user.usage.aiUsed }); return;
    }

    // ---- ASSISTANT ----
    if (action === 'ask-assistant') {
      const prompt = clean(body.prompt, 1200);
      if (!prompt) { res.status(400).json({ error: 'Ask Nitro a question first.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const { company, industry } = ctx(user);
      const context = `Company: ${company}. Industry: ${industry}. Goals: ${(user.onboarding?.data?.goals || []).join(', ') || 'Not set'}.`;
      // Optional short conversation history from the client for coherent multi-turn threads.
      let transcript = '';
      if (Array.isArray(body.history)) {
        transcript = body.history.slice(-6)
          .map(m => `${m && m.role === 'assistant' ? 'You' : 'User'}: ${clean(m && m.text, 700)}`)
          .filter(Boolean).join('\n');
      }
      const answer = await generate(`You are Nitro, a sharp, practical growth assistant for a small business. ${context}\n\nStyle: get straight to the point. Answer in under 180 words. Use light Markdown only where it helps — bold key terms and short - bullet lists. No preamble, no filler, no restating the question.${transcript ? `\n\nConversation so far:\n${transcript}` : ''}\n\nUser: ${prompt}`, 450, FAST_MODEL);
      const entry = { id: id('chat'), prompt, answer: clean(answer, 6000), createdAt: new Date().toISOString() };
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
      const draft = {
        id: id('social'), text,
        platform: clean(body.platform, 30) || 'instagram',
        imageUrl: clean(body.imageUrl, 600) || null,
        scheduledFor: isNaN(ts) ? null : new Date(ts).toISOString(),
        status: isNaN(ts) ? 'draft' : 'scheduled',
        createdAt: new Date().toISOString(),
      };
      data.socialDrafts.unshift(draft);
      await saveCustomer(user);
      res.status(201).json({ ok: true, draft }); return;
    }

    // ---- ADS: build a real, detailed campaign plan ----
    if (action === 'build-campaign' || action === 'create-campaign') {
      if (!['growth', 'pro', 'scale'].includes(plan.id)) { res.status(403).json({ error: 'Ad campaign management starts on the Growth plan.' }); return; }
      const name = clean(body.name, 140);
      if (!name) { res.status(400).json({ error: 'Give this campaign a name.' }); return; }
      if (!creditsLeft()) { res.status(403).json({ error: usageError(plan) }); return; }
      const objective = clean(body.objective, 500) || 'get more leads';
      const budget = clean(body.budget, 40) || 'a small monthly budget';
      const { company, industry } = ctx(user);
      const plan_text = await generate(`You are a senior paid-media strategist. Build a concrete, ready-to-launch ad campaign plan for this business.

Business: ${company} (${industry})
Campaign name: ${name}
Objective: ${objective}
Budget: ${budget}

Write a clear, well-structured plan in Markdown with these sections:
1. Recommended platform(s) and why (Meta, Google, etc.)
2. Target audience (specific demographics, interests, locations)
3. Budget breakdown and suggested daily spend
4. Three ad copy variants (each with a headline, primary text, and CTA)
5. Creative direction (what the image/video should show)
6. A step-by-step launch checklist the owner can follow themselves.

Be specific and practical. Do not invent fake performance numbers.`, 1600);
      const campaign = { id: id('campaign'), name, objective, budget, status: 'planned', plan: clean(plan_text, 12000), createdAt: new Date().toISOString() };
      data.campaigns.unshift(campaign);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(201).json({ ok: true, campaign, aiUsed: user.usage.aiUsed }); return;
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
      data.content = data.content.filter(c => c.id !== cid);
      try { await kv.del(`customer:img:${cid}`); } catch {}
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
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
    res.status(500).json({ error: 'That action could not be completed. Please try again.' });
  }
}
