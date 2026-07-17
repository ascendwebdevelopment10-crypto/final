import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';
import { isAuthorized } from '../lib/auth.js';
import { getTotalStats, getEmailLog, getSmsLog, getReplies } from '../lib/store.js';

export const config = { maxDuration: 120 };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const start = Math.min(...['{', '['].map(c => { const i = cleaned.indexOf(c); return i < 0 ? Infinity : i; }));
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (Number.isFinite(start) && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('The agent returned an unreadable response. Please run it again.');
  }
}

async function askJson(prompt, maxTokens = 1800) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.35,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  return parseJson(text);
}

async function saveRun(type, summary, result) {
  const entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), type, summary, timestamp: Date.now(), result };
  await kv.lpush('agents:runs', JSON.stringify(entry));
  await kv.ltrim('agents:runs', 0, 29);
  return entry;
}

function aggregatePerformance(emails, sms) {
  const groups = {};
  for (const item of [...emails, ...sms]) {
    const key = (item.service || 'unknown') + ' / ' + (item.segment || 'general');
    if (!groups[key]) groups[key] = { sent: 0, replies: 0 };
    groups[key].sent++;
    if (item.replied) groups[key].replies++;
  }
  return Object.entries(groups).map(([name, value]) => ({
    name,
    sent: value.sent,
    replies: value.replies,
    replyRate: value.sent ? Math.round(value.replies / value.sent * 1000) / 10 : 0
  })).sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent).slice(0, 12);
}

async function growthAnalyst() {
  const [stats, emails, sms] = await Promise.all([getTotalStats(), getEmailLog(500), getSmsLog(500)]);
  const performance = aggregatePerformance(emails, sms);
  const prompt = `You are the Growth Analyst for Ascend Web Development, which sells websites, mobile apps, online presence management, and ads to US businesses.

Analyze this real outreach performance data:
${JSON.stringify({ stats, performance })}

Give specific, evidence-based recommendations. Do not invent metrics or imply causation from tiny samples. Respect opt-outs and suppression rules. Return STRICT JSON only:
{"headline":"...","diagnosis":"...","wins":["..."],"risks":["..."],"recommendations":[{"title":"...","why":"...","action":"...","priority":"high|medium|low"}],"nextExperiment":{"name":"...","hypothesis":"...","audience":"...","successMetric":"..."}}`;
  const result = await askJson(prompt, 1900);
  await saveRun('growth', result.headline || 'Performance analysis completed', result);
  return result;
}

async function campaignBuilder(input) {
  const industry = clean(input.industry, 100);
  const location = clean(input.location, 100);
  const offer = clean(input.offer, 240);
  const goal = clean(input.goal, 500);
  if (!industry || !offer) throw new Error('Industry and offer are required.');
  const prompt = `You are the Campaign Builder for Ascend Web Development.
Target industry: ${industry}
Market/location: ${location || 'United States'}
Offer: ${offer}
Campaign goal: ${goal || 'Start qualified conversations with business owners'}

Build a concise, credible B2B outreach campaign. Never fabricate personalization, results, clients, urgency, or scarcity. Avoid spammy language. Email must include a simple opt-out sentence. SMS may only be used where the sender has appropriate consent or another lawful basis and must include "Reply STOP to opt out." All messages require human approval before sending.

Return STRICT JSON only:
{"campaignName":"...","positioning":"...","idealCustomer":{"description":"...","signals":["..."],"exclusions":["..."]},"offerAngle":"...","email":{"subject":"...","body":"..."},"sms":{"body":"...","complianceNote":"..."},"followUp":{"subject":"...","body":"..."},"qualificationQuestions":["..."],"dailyPlan":["..."],"successMetrics":["..."]}`;
  const result = await askJson(prompt, 2200);
  await saveRun('campaign', result.campaignName || `${industry} campaign`, result);
  return result;
}

async function replyCloser() {
  const replies = (await getReplies(60)).filter(r => r && r.type !== 'sms_reply_out' && r.type !== 'email_reply_out' && (r.body || r.subject)).slice(0, 15);
  if (!replies.length) return { headline: 'No inbound replies to analyze yet', opportunities: [] };
  const safeReplies = replies.map((r, index) => ({
    index,
    channel: r.type === 'sms_reply' ? 'sms' : 'email',
    subject: clean(r.subject, 160),
    body: clean(String(r.body || '').replace(/<[^>]+>/g, ' '), 900),
    receivedAt: r.timestamp || null
  }));
  const prompt = `You are the Reply Closer for Ascend Web Development. Analyze these inbound prospect replies and help a human salesperson respond.
${JSON.stringify(safeReplies)}

Never pressure, deceive, or continue outreach when someone opts out, says stop, is hostile, or clearly declines. Mark those as do_not_contact and provide no sales reply beyond a brief confirmation when appropriate. Do not claim work was completed or promise pricing. Return STRICT JSON only:
{"headline":"...","opportunities":[{"index":0,"priority":"hot|warm|cold|do_not_contact","intent":"...","reason":"...","suggestedReply":"...","nextAction":"..."}]}`;
  const result = await askJson(prompt, 2200);
  result.opportunities = (result.opportunities || []).map(item => {
    const original = replies[Number(item.index)] || {};
    return {
      ...item,
      contact: clean(original.from || original.originalTo || 'Unknown prospect', 180),
      channel: original.type === 'sms_reply' ? 'SMS' : 'Email',
      receivedAt: original.timestamp || null
    };
  });
  await saveRun('replies', result.headline || 'Replies analyzed', result);
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  if (req.method === 'GET') {
    const raw = await kv.lrange('agents:runs', 0, 14);
    const runs = raw.map(item => typeof item === 'string' ? JSON.parse(item) : item);
    res.status(200).json({ runs, agents: { growth: true, campaign: true, replies: true } });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const action = clean(req.body?.action, 40);
  try {
    let result;
    if (action === 'growth') result = await growthAnalyst();
    else if (action === 'campaign') result = await campaignBuilder(req.body || {});
    else if (action === 'replies') result = await replyCloser();
    else { res.status(400).json({ error: 'Unknown agent action' }); return; }
    res.status(200).json({ ok: true, action, result, generatedAt: Date.now() });
  } catch (error) {
    console.error('Agent Center error:', error);
    res.status(500).json({ error: error.message || 'Agent run failed' });
  }
}
