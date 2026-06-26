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
