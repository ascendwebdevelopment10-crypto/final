import crypto from 'node:crypto';
import { kv } from '@vercel/kv';

const COOKIE = 'ascend_customer_session';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERS = 210000;

function signingKey() {
  return 'ascend-customer-v1:' + (process.env.CUSTOMER_AUTH_SECRET || process.env.CRON_SECRET || '');
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseStored(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

export function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function passwordIssue(value) {
  const password = String(value || '');
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 200) return 'Password is too long';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return 'Include uppercase, lowercase, and a number';
  return '';
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), PASSWORD_ITERS, 32, 'sha256').toString('hex');
  return `${PASSWORD_ITERS}:${salt}:${hash}`;
}

export function verifyCustomerPassword(password, encoded) {
  const [iterations, salt, expected] = String(encoded || '').split(':');
  if (!iterations || !salt || !expected) return false;
  const got = crypto.pbkdf2Sync(String(password || ''), Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha256').toString('hex');
  return safeEqual(got, expected);
}

export function customerSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: String(userId), exp: Date.now() + SESSION_TTL })).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${COOKIE}=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}

export function clearCustomerSessionCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function customerIdFromRequest(req) {
  if (!process.env.CUSTOMER_AUTH_SECRET && !process.env.CRON_SECRET) return '';
  const match = String(req.headers?.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!match) return '';
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return '';
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return '';
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || !Number.isFinite(data.exp) || data.exp < Date.now()) return '';
    return String(data.uid);
  } catch { return ''; }
}

export async function getCustomer(userId) {
  return parseStored(await kv.get('customer:user:' + userId));
}

export async function getCustomerByEmail(email) {
  const id = await kv.get('customer:email:' + normalizeEmail(email));
  return id ? getCustomer(String(id)) : null;
}

export async function saveCustomer(user) {
  user.updatedAt = new Date().toISOString();
  await kv.set('customer:user:' + user.id, JSON.stringify(user));
  await kv.set('customer:email:' + normalizeEmail(user.email), user.id);
  return user;
}

export async function currentCustomer(req) {
  const id = customerIdFromRequest(req);
  return id ? getCustomer(id) : null;
}

export function publicCustomer(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export async function createActionToken(kind, userId, ttlSeconds) {
  const token = crypto.randomBytes(32).toString('base64url');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  await kv.set(`customer:${kind}:${digest}`, String(userId), { ex: ttlSeconds });
  return token;
}

export async function consumeActionToken(kind, token) {
  const digest = crypto.createHash('sha256').update(clean(token, 200)).digest('hex');
  const key = `customer:${kind}:${digest}`;
  const userId = await kv.get(key);
  if (userId) await kv.del(key);
  return userId ? String(userId) : '';
}

export function requestOrigin(req) {
  const proto = clean(req.headers?.['x-forwarded-proto'], 20) || 'https';
  const host = clean(req.headers?.['x-forwarded-host'] || req.headers?.host, 300);
  return `${proto}://${host}`;
}

export function sameOrigin(req) {
  const origin = clean(req.headers?.origin, 500);
  return !origin || origin === requestOrigin(req);
}

export async function rateLimit(key, limit, seconds) {
  const safeKey = clean(key, 300).replace(/[^a-zA-Z0-9:@._-]/g, '');
  const storageKey = 'customer:rate:' + safeKey;
  const count = await kv.incr(storageKey);
  if (count === 1) await kv.expire(storageKey, seconds);
  return count <= limit;
}

export function clientIp(req) {
  return clean(String(req.headers?.['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown', 100);
}
