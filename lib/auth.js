import crypto from 'crypto';

// Dashboard password is verified against this PBKDF2-SHA256 hash (210k iterations).
// The password itself is never stored. Session cookies are HMAC-signed with a key
// derived from CRON_SECRET, so rotating CRON_SECRET invalidates all sessions.
const PW_SALT = 'eea9d9fbe4fa35e12af5aafd9b065510';
const PW_HASH = 'bf14e68bb0ca727c86986c1bd23e5c583fee68f0e33682cec03d39bfd51f6703';
const PW_ITERS = 210000;

const COOKIE_NAME = 'dash_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function signingKey() {
  return 'dash-session-v1:' + (process.env.CRON_SECRET || '') + ':' + PW_HASH;
}

export function verifyPassword(pw) {
  if (typeof pw !== 'string' || !pw || pw.length > 200) return false;
  const got = crypto.pbkdf2Sync(pw, Buffer.from(PW_SALT, 'hex'), PW_ITERS, 32, 'sha256');
  const want = Buffer.from(PW_HASH, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function makeSessionCookie() {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac('sha256', signingKey()).update(String(exp)).digest('hex');
  return COOKIE_NAME + '=' + exp + '.' + sig + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000);
}

export function logoutCookie() {
  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

export function hasValidSession(req) {
  const raw = (req.headers && req.headers.cookie) || '';
  const m = raw.match(/(?:^|;\s*)dash_session=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 2) return false;
  const exp = parseInt(parts[0], 10);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = crypto.createHmac('sha256', signingKey()).update(String(exp)).digest('hex');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// True if the request carries a valid browser session cookie, a cron Bearer
// token, or a key (body/query) matching one of the server secrets.
export function isAuthorized(req) {
  if (hasValidSession(req)) return true;
  const secrets = [process.env.CRON_SECRET, process.env.SUPPRESS_API_SECRET].filter(Boolean);
  if (!secrets.length) return false;
  const bearer = ((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  const key = (req.body && req.body.key) || (req.query && req.query.key) || '';
  return secrets.some((s) => s === bearer || s === key);
}

// Shared-secret check for provider webhooks (Resend, SNS). The secret is passed
// as a ?token= query param on the webhook URL configured in each provider's
// dashboard. Fail-closed: if WEBHOOK_TOKEN is unset, all requests are rejected.
export function checkWebhookToken(req) {
  const expected = process.env.WEBHOOK_TOKEN;
  if (!expected) return false;
  const got = (req.query && req.query.token) || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
