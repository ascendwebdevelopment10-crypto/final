import crypto from 'node:crypto';

function secret() {
  return process.env.CUSTOMER_AUTH_SECRET || process.env.CRON_SECRET || process.env.META_APP_SECRET || 'dev-secret';
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 24);
}

export function makeSocialLinkToken(userId, mediaId, destination) {
  const url = new URL(String(destination || ''));
  if (url.protocol !== 'https:') throw new Error('A secure website is required for tracked links.');
  const payload = Buffer.from(JSON.stringify({ u: String(userId), m: String(mediaId), d: url.toString(), p: 'instagram' })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function parseSocialLinkToken(token) {
  const [payload, supplied] = String(token || '').split('.');
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const url = new URL(value.d);
    if (!value.u || !value.m || value.p !== 'instagram' || url.protocol !== 'https:') return null;
    return { userId: String(value.u), mediaId: String(value.m), destination: url.toString(), platform: value.p };
  } catch { return null; }
}
