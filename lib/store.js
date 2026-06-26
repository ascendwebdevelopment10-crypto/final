// Suppression store backed by Vercel KV (or Upstash) over REST. No SDK needed.
// One Redis set called "suppressed". Add Vercel KV / Upstash to the project and
// the env vars below get injected automatically.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeReady = Boolean(URL && TOKEN);

async function cmd(parts) {
  if (!storeReady) throw new Error("No KV store configured. Add Vercel KV or Upstash Redis to the project.");
  const path = parts.map((p) => encodeURIComponent(p)).join("/");
  const res = await fetch(`${URL}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`KV ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

export const addSuppressed = (email) => cmd(["sadd", "suppressed", email.toLowerCase().trim()]);
export const isSuppressed = (email) => cmd(["sismember", "suppressed", email.toLowerCase().trim()]).then((r) => r === 1);
export const listSuppressed = () => cmd(["smembers", "suppressed"]);

// --- contacted dedupe + daily send counter (for the autonomous cron) ---
export const addContacted = (email) => cmd(["sadd", "contacted", email.toLowerCase().trim()]);
export const isContacted = (email) => cmd(["sismember", "contacted", email.toLowerCase().trim()]).then((r) => r === 1);

const today = () => new Date().toISOString().slice(0, 10);
export async function sentToday() {
  try { return parseInt((await cmd(["get", `sent:${today()}`])) || "0", 10); } catch { return 0; }
}
export async function incrSentToday(n = 1) {
  const key = `sent:${today()}`;
  const v = await cmd(["incrby", key, String(n)]);
  await cmd(["expire", key, "172800"]); // keep 2 days
  return v;
}

// Track Apollo person ids we've already enriched, so cron never spends credits twice.
export const addSeen = (id) => cmd(["sadd", "seen", String(id)]);
export const isSeen = (id) => cmd(["sismember", "seen", String(id)]).then((r) => r === 1);

// --- Email send log (sorted set by timestamp, newest first) ---
// Each entry is a JSON string stored in a Redis sorted set "email_log"
// Score = unix timestamp ms, so we can range-query by recency
export async function logEmail(entry) {
  const score = Date.now();
  const value = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  await cmd(["zadd", "email_log", String(score), value]);
  // Trim to last 10000 entries
  await cmd(["zremrangebyrank", "email_log", "0", "-10001"]);
}

export async function getEmailLog(limit = 200, offset = 0) {
  // newest first: use zrevrange
  const items = await cmd(["zrevrange", "email_log", String(offset), String(offset + limit - 1)]);
  if (!Array.isArray(items)) return [];
  return items.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

export async function getDailySentCounts(days = 30) {
  const results = {};
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    try {
      const val = await cmd(["get", `sent:${key}`]);
      results[key] = parseInt(val || "0", 10);
    } catch {
      results[key] = 0;
    }
  }
  return results;
}

// --- Reply / response tracking ---
// When a reply comes in via webhook, mark the email as replied
export async function markReplied(emailAddr, messageId) {
  const score = Date.now();
  const value = JSON.stringify({ email: emailAddr.toLowerCase(), messageId, ts: new Date().toISOString() });
  await cmd(["zadd", "reply_log", String(score), value]);
  await cmd(["sadd", "replied_set", emailAddr.toLowerCase()]);
}

export const hasReplied = (email) => cmd(["sismember", "replied_set", email.toLowerCase()]).then(r => r === 1);

export async function getReplyLog(limit = 200) {
  const items = await cmd(["zrevrange", "reply_log", "0", String(limit - 1)]);
  if (!Array.isArray(items)) return [];
  return items.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

export async function getTotalStats() {
  const [totalContacted, totalSuppressed, totalReplied] = await Promise.all([
    cmd(["scard", "contacted"]),
    cmd(["scard", "suppressed"]),
    cmd(["scard", "replied_set"]),
  ]);
  return {
    totalSent: parseInt(totalContacted || 0),
    totalUnsubscribed: parseInt(totalSuppressed || 0),
    totalReplied: parseInt(totalReplied || 0),
  };
}
