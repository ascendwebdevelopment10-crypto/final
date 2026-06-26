// Autonomous sender. Vercel Cron hits this on a schedule. Each run sends a small,
// capped batch: it searches Apollo (free), skips anyone already seen/contacted/
// suppressed, enriches only NEW people, writes each email with Claude, and sends.
import { searchPeople, enrichBatch } from "../lib/apollo.js";
import { writeEmail } from "../lib/personalize.js";
import { sendEmail } from "../lib/mailer.js";
import {
  storeReady, isSuppressed, isContacted, addContacted,
  isSeen, addSeen, sentToday, incrSentToday, logEmail,
} from "../lib/store.js";

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });

  if (process.env.AUTOSEND_ENABLED !== "true") {
    return res.status(200).json({ skipped: "AUTOSEND_ENABLED is not true" });
  }
  if (!storeReady) return res.status(500).json({ error: "no KV store configured" });

  const cfg = {
    apolloKey: process.env.APOLLO_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    resendKey: process.env.RESEND_API_KEY,
    from: process.env.FROM,
    replyTo: process.env.REPLY_TO,
    companyName: process.env.COMPANY_NAME,
    physicalAddress: process.env.PHYSICAL_ADDRESS,
    unsubscribeEmail: process.env.UNSUBSCRIBE_EMAIL,
    unsubscribeUrl: process.env.UNSUBSCRIBE_URL,
  };
  const target = {
    titles: list(process.env.TARGET_TITLES),
    keywords: list(process.env.TARGET_KEYWORDS),
    locations: list(process.env.TARGET_LOCATIONS),
  };
  const senderPitch = process.env.SENDER_PITCH || `${cfg.companyName} helps companies like the recipient's get more booked calls.`;
  const dailyCap = parseInt(process.env.DAILY_CAP || "20", 10);
  const batchSize = parseInt(process.env.BATCH_SIZE || "5", 10);
  const delayMs = parseInt(process.env.SEND_DELAY_SECONDS || "3", 10) * 1000;

  const already = await sentToday();
  const room = Math.max(0, dailyCap - already);
  const want = Math.min(batchSize, room);
  if (want <= 0) return res.status(200).json({ sentToday: already, dailyCap, note: "daily cap reached" });

  let found;
  try { found = await searchPeople(cfg.apolloKey, target); }
  catch (e) { return res.status(502).json({ error: `apollo search: ${e.message}` }); }

  const fresh = [];
  for (const p of found) {
    if (fresh.length >= want) break;
    if (!(p.has_email || p.email_status === "verified")) continue;
    if (await isSeen(p.id)) continue;
    fresh.push(p);
  }
  if (!fresh.length) return res.status(200).json({ sentToday: already, note: "no new leads this run" });

  let matches = [];
  try { matches = await enrichBatch(cfg.apolloKey, fresh); }
  catch (e) { return res.status(502).json({ error: `apollo enrich: ${e.message}` }); }
  for (const p of fresh) { try { await addSeen(p.id); } catch {} }

  const leads = [];
  for (const m of matches) {
    if (!m?.email || /email_not_unlocked/i.test(m.email)) continue;
    const email = m.email.toLowerCase();
    if (await isSuppressed(email) || await isContacted(email)) continue;
    leads.push({
      firstName: m.first_name || (m.name || "there").split(" ")[0],
      lastName: m.last_name || "",
      email: m.email,
      title: m.title || "",
      company: m.organization?.name || "",
      website: m.organization?.website_url || "",
      signal: m.headline || m.organization?.short_description || `works as ${m.title || "a decision-maker"}`,
    });
  }

  const drafts = await Promise.all(
    leads.map((l) => writeEmail(cfg.anthropicKey, cfg.model, l, { senderPitch }).then((d) => ({ l, d })))
  );

  const results = [];
  for (const [i, { l, d }] of drafts.entries()) {
    try {
      const id = await sendEmail(cfg, l, d.subject, d.body);
      await addContacted(l.email);
      // Log the sent email for the dashboard
      await logEmail({
        type: "sent",
        resendId: id,
        to: l.email,
        firstName: l.firstName,
        lastName: l.lastName,
        title: l.title,
        company: l.company,
        website: l.website,
        subject: d.subject,
        status: "sent",
      }).catch(() => {});
      results.push({ email: l.email, status: "sent", id });
    } catch (e) {
      await logEmail({
        type: "sent",
        to: l.email,
        firstName: l.firstName,
        lastName: l.lastName,
        title: l.title,
        company: l.company,
        subject: d.subject,
        status: "failed",
        error: e.message,
      }).catch(() => {});
      results.push({ email: l.email, status: "failed", error: e.message });
    }
    if (i < drafts.length - 1) await sleep(delayMs);
  }

  const sent = results.filter((r) => r.status === "sent").length;
  if (sent) await incrSentToday(sent);

  const summary = { sent, attempted: results.length, sentTodayNow: already + sent, dailyCap, results };
  console.log("[cron]", JSON.stringify(summary));
  return res.status(200).json(summary);
}
