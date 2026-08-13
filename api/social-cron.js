import { kv } from '@vercel/kv';
import { metaConfigured, publishImage } from '../lib/meta.js';
import { notifyBestEffort } from '../lib/ntfy.js';

export const config = { maxDuration: 60 };
const CRON_SECRET = process.env.CRON_SECRET;

export const NITRO_SOCIAL_CAMPAIGN = [
  {
    id: '2026-08-one-workspace',
    scheduledFor: '2026-08-13T17:30:00.000Z',
    imagePath: '/social/aug-2026/01-one-workspace.jpg',
    caption: 'Your website, content, social, ads, and outreach should work together—not live in five different tabs. Nitro puts the operation in one place. Start free at nitrooutreach.com.\n\n#smallbusinessmarketing #marketingtools #nitrooutreach',
  },
  {
    id: '2026-08-website',
    scheduledFor: '2026-08-14T17:30:00.000Z',
    imagePath: '/social/aug-2026/02-website.jpg',
    caption: 'A website is only useful if it helps the next conversation happen. Build the site, understand the traffic, and follow up from the same workspace.\n\n#businesswebsite #leadgeneration #smallbusiness',
  },
  {
    id: '2026-08-content',
    scheduledFor: '2026-08-15T17:30:00.000Z',
    imagePath: '/social/aug-2026/03-content.jpg',
    caption: 'One solid idea can become a week of useful content. Nitro helps turn the idea into posts, Reel scripts, and campaign copy without losing your voice.\n\n#contentmarketing #reelsstrategy #smallbusinessowner',
  },
  {
    id: '2026-08-social',
    scheduledFor: '2026-08-16T17:30:00.000Z',
    imagePath: '/social/aug-2026/04-social.jpg',
    caption: 'Consistency gets easier when the queue is visible. Draft, schedule, edit, and catch posts that need attention before they miss the moment.\n\n#socialmediamarketing #contentscheduler #marketingworkflow',
  },
  {
    id: '2026-08-outreach',
    scheduledFor: '2026-08-17T17:30:00.000Z',
    imagePath: '/social/aug-2026/05-outreach.jpg',
    caption: 'Opens are interesting. Replies are useful. Nitro keeps opens, clicks, site visits, and replies in one view so follow-up is based on real signals.\n\n#outreach #salesfollowup #leadtracking',
  },
  {
    id: '2026-08-start-free',
    scheduledFor: '2026-08-18T17:30:00.000Z',
    imagePath: '/social/aug-2026/06-start-free.jpg',
    caption: 'Do the marketing work without adding another pile of disconnected tools. Nitro has a free forever plan and doesn’t require a credit card. Start at nitrooutreach.com.\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach',
  },
];

async function runNitroCampaign(now = Date.now()) {
  let connection = await kv.get('instagram:connection');
  if (typeof connection === 'string') { try { connection = JSON.parse(connection); } catch { connection = null; } }
  if (!connection?.igUserId || !connection?.accessToken) {
    return { published: 0, errors: [], skipped: 'nitro-instagram-not-connected' };
  }

  let state = await kv.get('nitro:social:campaign:2026-08');
  if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = {}; } }
  state = state && typeof state === 'object' ? state : {};
  let published = 0;
  const errors = [];

  for (const post of NITRO_SOCIAL_CAMPAIGN) {
    if (state[post.id]?.mediaId || Date.parse(post.scheduledFor) > now) continue;
    const lockKey = `nitro:social:publish-lock:${post.id}`;
    const locked = await kv.set(lockKey, '1', { nx: true, ex: 300 });
    if (!locked) continue;
    try {
      const mediaId = await publishImage(
        connection.igUserId,
        connection.accessToken,
        post.caption,
        `https://nitrooutreach.com${post.imagePath}`,
      );
      state[post.id] = { mediaId, publishedAt: new Date().toISOString() };
      await kv.set('nitro:social:campaign:2026-08', state);
      published += 1;
    } catch (error) {
      errors.push({ campaign: post.id, error: error.message });
      await kv.del(lockKey);
      await notifyBestEffort({ title: 'Nitro Instagram post failed', message: `${post.id}: ${error.message}`, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com' });
    }
  }
  return { published, errors };
}

async function loadCustomer(id) {
  let u = await kv.get(`customer:user:${id}`);
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
  return u;
}

// Publish any scheduled Instagram posts whose time has arrived, for connected customers.
// Exported so the main cron can also run it without a separate schedule.
export async function runSocialPublish() {
  const now = Date.now();
  const nitro = await runNitroCampaign(now);
  let published = nitro.published || 0;
  const errors = [...(nitro.errors || [])];
  if (!metaConfigured()) return { skipped: 'customer-meta-not-configured', nitro, published, errors };
  const keys = await kv.keys('customer:user:*');
  for (const key of keys) {
    const user = await loadCustomer(key.split(':').pop());
    if (!user?.meta?.token || !user?.meta?.igUserId) continue;
    const posts = user.workspace?.socialDrafts || [];
    const due = posts.filter(p => p.status === 'scheduled' && p.scheduledFor && Date.parse(p.scheduledFor) <= now);
    if (!due.length) continue;
    let changed = false;
    for (const post of due) {
      try {
        if (!post.imageUrl) throw new Error('This scheduled Instagram post has no public image URL. Add media and reschedule it.');
        const mediaId = await publishImage(user.meta.igUserId, user.meta.token, post.text, post.imageUrl);
        post.status = 'published'; post.publishedAt = new Date().toISOString(); post.mediaId = mediaId;
        published += 1; changed = true;
      } catch (e) {
        post.status = 'failed'; post.error = e.message; changed = true;
        errors.push({ user: user.id, error: e.message });
        await notifyBestEffort({ title: 'Scheduled social post failed', message: `${user.email || user.id}: ${e.message}`, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com/app#content' });
      }
    }
    if (changed) await kv.set(key, user);
  }
  return { published, errors, nitro };
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
