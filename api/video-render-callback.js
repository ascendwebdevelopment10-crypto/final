import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { getCustomer, saveCustomer } from '../lib/customer-auth.js';

function clean(value, max = 2000) { return String(value || '').trim().slice(0, max); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const jobId = clean(req.body?.jobId, 100);
  const status = clean(req.body?.status, 30);
  const outputUrl = clean(req.body?.outputUrl, 1800);
  const expected = crypto.createHmac('sha256', process.env.MODAL_SHARED_SECRET || '')
    .update(`${jobId}:${status}:${outputUrl}`).digest('hex');
  if (!process.env.MODAL_SHARED_SECRET || !safeEqual(req.body?.signature, expected)) {
    res.status(403).json({ error: 'Invalid render callback' }); return;
  }

  const stored = await kv.get(`video:job:${jobId}`);
  const job = typeof stored === 'string' ? JSON.parse(stored) : stored;
  if (!job) { res.status(404).json({ error: 'Render not found' }); return; }
  if (['completed', 'failed'].includes(job.status)) { res.status(200).json({ ok: true }); return; }

  job.status = status === 'completed' ? 'completed' : 'failed';
  job.progress = job.status === 'completed' ? 100 : 0;
  job.outputUrl = job.status === 'completed' ? outputUrl : '';
  job.actualDuration = job.status === 'completed'
    ? Math.max(1, Number(req.body?.actualDuration || job.duration))
    : job.duration;
  job.error = job.status === 'failed'
    ? 'Nitro could not finish this Reel. Your credits were refunded—please try again with the same prompt.'
    : '';
  job.updatedAt = new Date().toISOString();
  if (job.status === 'failed' && Number(job.chargedCredits || (job.chargedCredit ? 1 : 0)) > 0 && !job.refunded) {
    const user = await getCustomer(job.customerId);
    if (user) {
      user.usage = user.usage || {};
      user.usage.videoCredits = Number(user.usage.videoCredits || 0) + Number(job.chargedCredits || 1);
      await saveCustomer(user);
      job.refunded = true;
    }
  }
  if (job.status === 'completed') {
    const user = await getCustomer(job.customerId);
    if (user) {
      user.workspace = user.workspace || {};
      user.workspace.content = Array.isArray(user.workspace.content) ? user.workspace.content : [];
      user.workspace.content.unshift({
        id: job.id,
        type: 'video',
        topic: job.title,
        prompt: job.prompt,
        caption: job.caption,
        duration: job.actualDuration || job.duration,
        creditCost: job.creditCost,
        mediaUrl: outputUrl,
        format: 'reel',
        createdAt: job.updatedAt,
      });
      user.workspace.content = user.workspace.content.slice(0, 100);
      await saveCustomer(user);
    }
  }
  await kv.set(`video:job:${jobId}`, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
  res.status(200).json({ ok: true });
}
