import {
  getEmailLog, getReplyLog, getDailySentCounts, getTotalStats,
  listSuppressed, storeReady
} from "../lib/store.js";

export default async function handler(req, res) {
  if (!storeReady) return res.status(500).json({ error: "no KV store configured" });

  const limit = Math.min(parseInt(req.query.limit || "200"), 1000);
  const offset = parseInt(req.query.offset || "0");

  try {
    const [emails, replies, dailyCounts, stats, suppressed] = await Promise.all([
      getEmailLog(limit, offset),
      getReplyLog(100),
      getDailySentCounts(30),
      getTotalStats(),
      listSuppressed(),
    ]);

    const repliedSet = new Set(replies.map(r => r.email?.toLowerCase()));
    const enrichedEmails = emails.map(e => ({
      ...e,
      replied: repliedSet.has(e.to?.toLowerCase()),
    }));

    return res.status(200).json({
      stats,
      emails: enrichedEmails,
      replies,
      dailyCounts,
      suppressed: Array.isArray(suppressed) ? suppressed : [],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
