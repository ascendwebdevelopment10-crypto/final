import Anthropic from '@anthropic-ai/sdk';
import { currentCustomer, sameOrigin, saveCustomer, rateLimit } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';

export const config = { maxDuration: 30 };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function workspace(user) {
  user.workspace = user.workspace || { websites: [], content: [], socialDrafts: [], campaigns: [], assistant: [] };
  for (const key of ['websites', 'content', 'socialDrafts', 'campaigns', 'assistant']) {
    if (!Array.isArray(user.workspace[key])) user.workspace[key] = [];
  }
  user.usage = user.usage || {};
  user.usage.aiUsed = Number(user.usage.aiUsed || 0);
  return user.workspace;
}
function usageError(plan) { return `You've used all ${plan.aiCredits} AI credits on the ${plan.name} plan. Upgrade to continue.`; }
function textOf(message) { return message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() || ''; }
async function generate(prompt, maxTokens = 700) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI generation is not configured yet. Please try again later.');
  const result = await anthropic.messages.create({ model: MODEL, max_tokens: maxTokens, temperature: 0.6, messages: [{ role: 'user', content: prompt }] });
  return textOf(result);
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
  try {
    if (action === 'create-website') {
      if (plan.websites !== null && data.websites.length >= plan.websites) { res.status(403).json({ error: `Your ${plan.name} plan includes ${plan.websites} website${plan.websites === 1 ? '' : 's'}. Upgrade to add more.` }); return; }
      const name = clean(body.name, 100);
      if (!name) { res.status(400).json({ error: 'Give your website a name.' }); return; }
      const website = { id: id('site'), name, url: clean(body.url, 300), status: 'draft', createdAt: new Date().toISOString() };
      data.websites.unshift(website); user.usage.websites = data.websites.length;
      await saveCustomer(user); res.status(201).json({ ok: true, website }); return;
    }
    if (action === 'generate-content') {
      const topic = clean(body.topic, 600);
      if (!topic) { res.status(400).json({ error: 'Enter a topic for the content.' }); return; }
      if (plan.aiCredits !== null && user.usage.aiUsed >= plan.aiCredits) { res.status(403).json({ error: usageError(plan) }); return; }
      const company = clean(user.company?.name || user.companyName || user.onboarding?.data?.companyName || 'the business', 140);
      const content = await generate(`Write a polished, useful social post for ${company}. Topic: ${topic}. Include a clear hook, a concise body, a helpful call to action, and 3-5 relevant hashtags. Do not claim results you cannot prove. Return only the ready-to-post copy.`, 500);
      const item = { id: id('content'), topic, text: clean(content, 5000), createdAt: new Date().toISOString() };
      data.content.unshift(item); data.content = data.content.slice(0, plan.id === 'free' ? 10 : 100);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(201).json({ ok: true, content: item, aiUsed: user.usage.aiUsed }); return;
    }
    if (action === 'ask-assistant') {
      const prompt = clean(body.prompt, 1200);
      if (!prompt) { res.status(400).json({ error: 'Ask Nitro a question first.' }); return; }
      if (plan.aiCredits !== null && user.usage.aiUsed >= plan.aiCredits) { res.status(403).json({ error: usageError(plan) }); return; }
      const context = `Company: ${clean(user.company?.name || user.companyName || 'Not set', 140)}. Industry: ${clean(user.company?.industry || user.onboarding?.data?.industry || 'Not set', 100)}. Goals: ${(user.onboarding?.data?.goals || []).join(', ') || 'Not set'}.`;
      const answer = await generate(`You are Nitro, a practical growth assistant. ${context}\n\nAnswer this request clearly and actionably in no more than 500 words:\n${prompt}`, 700);
      const entry = { id: id('chat'), prompt, answer: clean(answer, 6000), createdAt: new Date().toISOString() };
      data.assistant.unshift(entry); data.assistant = data.assistant.slice(0, 12);
      user.usage.aiUsed += 1;
      await saveCustomer(user); res.status(200).json({ ok: true, entry, aiUsed: user.usage.aiUsed }); return;
    }
    if (action === 'create-social-draft') {
      if (plan.id === 'free') { res.status(403).json({ error: 'Social scheduling starts on the Starter plan.' }); return; }
      const text = clean(body.text, 3000);
      if (!text) { res.status(400).json({ error: 'Enter post copy first.' }); return; }
      const draft = { id: id('social'), text, status: 'draft', createdAt: new Date().toISOString() };
      data.socialDrafts.unshift(draft); await saveCustomer(user); res.status(201).json({ ok: true, draft }); return;
    }
    if (action === 'create-campaign') {
      if (!['growth', 'pro', 'scale'].includes(plan.id)) { res.status(403).json({ error: 'Ad campaign management starts on the Growth plan.' }); return; }
      const name = clean(body.name, 140);
      if (!name) { res.status(400).json({ error: 'Give this campaign a name.' }); return; }
      const campaign = { id: id('campaign'), name, objective: clean(body.objective, 500), status: 'draft', createdAt: new Date().toISOString() };
      data.campaigns.unshift(campaign); await saveCustomer(user); res.status(201).json({ ok: true, campaign }); return;
    }
    res.status(400).json({ error: 'Unknown workspace action' });
  } catch (error) {
    console.error('Customer workspace error:', error.message);
    res.status(500).json({ error: 'That action could not be completed. Please try again.' });
  }
}
