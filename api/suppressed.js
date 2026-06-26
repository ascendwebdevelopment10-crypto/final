// The sender calls this before a run to pull the current opt-out list,
// so locally-triggered sends honor unsubscribes/bounces recorded in the cloud.
// Protected by a shared secret to prevent anyone scraping your suppression set.
import { listSuppressed } from "../lib/store.js";

export default async function handler(req, res) {
  const key = (req.query.key || "").toString();
  if (!process.env.SUPPRESS_API_SECRET || key !== process.env.SUPPRESS_API_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const emails = await listSuppressed();
    return res.status(200).json({ count: emails.length, emails });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
