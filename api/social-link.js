import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { parseSocialLinkToken } from '../lib/social-links.js';

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function botRequest(req) {
  return /bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|whatsapp|telegram/i.test(clean(req.headers?.['user-agent'], 500));
}
function fingerprint(req) {
  const ip = clean(String(req.headers?.['x-forwarded-for'] || '').split(',')[0], 100);
  const ua = clean(req.headers?.['user-agent'], 500);
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 24);
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.status(405).send('Method not allowed'); return; }
  const parsed = parseSocialLinkToken(req.query?.t);
  if (!parsed) { res.status(400).send('This tracked link is invalid.'); return; }
  const destination = new URL(parsed.destination);
  destination.searchParams.set('utm_source', 'instagram');
  destination.searchParams.set('utm_medium', 'social');
  destination.searchParams.set('utm_campaign', `post_${parsed.mediaId.slice(-12)}`);
  if (req.method === 'GET' && !botRequest(req)) {
    const dedupeKey = `customer:social-click-dedupe:${parsed.userId}:${parsed.mediaId}:${fingerprint(req)}`;
    const seen = await kv.get(dedupeKey);
    if (!seen) {
      await Promise.all([
        kv.set(dedupeKey, '1', { ex: 1800 }),
        kv.incr(`customer:social-clicks:${parsed.userId}:${parsed.mediaId}`),
      ]);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: destination.toString() });
  res.end();
}
