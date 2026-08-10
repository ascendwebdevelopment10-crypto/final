import { kv } from '@vercel/kv';
import crypto from 'node:crypto';

export const FUNNEL_STAGES = ['visited', 'engaged', 'signup_viewed', 'signup_started', 'signup_submitted', 'account_created', 'paid'];

function safe(value, max = 160) { return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, max); }
export function funnelIdentity(value) { return crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 24); }

export async function recordFunnelEvent(stage, identity, details = {}) {
  if (!FUNNEL_STAGES.includes(stage) || !identity) return false;
  const id = funnelIdentity(identity);
  const first = await kv.set(`funnel:v1:first:${stage}:${id}`, new Date().toISOString(), { nx: true });
  if (!first) return false;
  const event = { stage, identity: id.slice(0, 10).toUpperCase(), at: new Date().toISOString(), path: safe(details.path, 240), source: safe(details.source, 120), email: safe(details.email, 160).toLowerCase() };
  await Promise.all([kv.incr(`funnel:v1:count:${stage}`), kv.lpush('funnel:v1:events', JSON.stringify(event)), kv.ltrim('funnel:v1:events', 0, 1999)]);
  return true;
}

export async function funnelSummary() {
  const counts = await Promise.all(FUNNEL_STAGES.map(stage => kv.get(`funnel:v1:count:${stage}`)));
  return FUNNEL_STAGES.map((stage, index) => ({ stage, count: Number(counts[index] || 0) }));
}
