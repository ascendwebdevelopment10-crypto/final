import { kv } from '@vercel/kv';
import { metaConfigured, publishImage } from '../lib/meta.js';

export const config = { maxDuration: 60 };
const CRON_SECRET = process.env.CRON_SECRET;

async function loadCustomer(id) {
  let u = await kv.get(`customer:user:${id}`);
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
  return u;
}

// Publish any scheduled Instagram posts whose time has arrived, for connected customers.
// Exported so the main cron can also run it without a separate schedule.
export async function runSocialPublish() {
  if (!metaConfigured()) return { skipped: 'meta-not-configured', published: 0 };
  const now = Date.now();
  let published = 0;
  const errors = [];
  const keys = await kv.keys('customer:user:*');
  for (const key of keys) {
    const user = await loadCustomer(key.split(':').pop());
    if (!user?.meta?.token || !user?.meta?.igUserId) continue;
    const posts = user.workspace?.socialDrafts || [];
    const due = posts.filter(p => p.status === 'scheduled' && p.scheduledFor && Date.parse(p.scheduledFor) <= now && p.imageUrl);
    if (!due.length) continue;
    let changed = false;
    for (const post of due) {
      try {
        const mediaId = await publishImage(user.meta.igUserId, user.meta.token, post.text, post.imageUrl);
        post.status = 'published'; post.publishedAt = new Date().toISOString(); post.mediaId = mediaId;
        published += 1; changed = true;
      } catch (e) {
        post.status = 'failed'; post.error = e.message; changed = true;
        errors.push({ user: user.id, error: e.message });
      }
    }
    if (changed) await kv.set(key, user);
  }
  return { published, errors };
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }
  try {
    const result = await runSocialPublish();
    res.status(200).json({ ...result, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ published: 0, errors: [{ fatal: e.message }] });
  }
}
