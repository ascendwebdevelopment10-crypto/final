import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { usableConnection } from '../lib/social-publishers.js';

function clean(value, max = 180) { return String(value || '').trim().slice(0, max); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }

  const id = clean(req.body?.id);
  if (!id) { res.status(400).json({ error: 'Missing failed post id.' }); return; }
  const drafts = Array.isArray(user.workspace?.socialDrafts) ? user.workspace.socialDrafts : [];
  const post = drafts.find(item => item?.id === id);
  if (!post) { res.status(404).json({ error: 'That social post could not be found.' }); return; }
  if (post.status !== 'failed') { res.status(409).json({ error: 'Only failed posts can be retried.' }); return; }
  if (/interrupted|avoid a duplicate/i.test(String(post.error || ''))) {
    res.status(409).json({ error: 'This publish attempt was interrupted before the platform confirmed the result. Check the platform first so Nitro does not create a duplicate post.', reviewRequired: true });
    return;
  }

  const platform = String(post.platform || 'instagram').toLowerCase();
  try {
    if (platform === 'instagram') {
      if (!user.meta?.token || !user.meta?.igUserId) throw new Error('Reconnect Instagram before retrying this post.');
    } else {
      user.socialConnections = { ...(user.socialConnections || {}) };
      user.socialConnections[platform] = await usableConnection(platform, user.socialConnections?.[platform]);
    }
  } catch (error) {
    res.status(409).json({ error: error.message || `Reconnect ${platform} before retrying.` });
    return;
  }

  const retryAt = new Date(Date.now() + 90_000).toISOString();
  post.status = 'scheduled';
  post.scheduledFor = retryAt;
  post.retryCount = Number(post.retryCount || 0) + 1;
  post.lastError = post.error || null;
  post.error = null;
  post.failedAt = null;
  post.publishingStartedAt = null;
  post.statusCheckError = null;
  post.externalPublishId = null;
  post.updatedAt = new Date().toISOString();
  await saveCustomer(user);
  res.status(200).json({ ok: true, id: post.id, status: post.status, scheduledFor: retryAt, retryCount: post.retryCount });
}
