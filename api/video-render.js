import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { currentCustomer, rateLimit, requestOrigin, sameOrigin, saveCustomer } from '../lib/customer-auth.js';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function renderSecret() { return process.env.MODAL_SHARED_SECRET || ''; }
function signJob(jobId, customerId) {
  return crypto.createHmac('sha256', renderSecret()).update(`${jobId}:${customerId}`).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method === 'GET') {
    const jobId = clean(req.query?.jobId, 100);
    if (!jobId) {
      res.status(200).json({
        configured: Boolean(process.env.MODAL_RENDER_URL && renderSecret()),
        balance: Number(user.usage?.videoCredits || 0),
      });
      return;
    }
    const job = await kv.get(`video:job:${jobId}`);
    const parsed = typeof job === 'string' ? JSON.parse(job) : job;
    if (!parsed || parsed.customerId !== user.id) { res.status(404).json({ error: 'Render not found' }); return; }
    res.status(200).json({ job: parsed }); return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (!process.env.MODAL_RENDER_URL || !renderSecret()) {
    res.status(503).json({ error: 'The Reel renderer is being connected. Try again shortly.' }); return;
  }
  if (!await rateLimit(`video-render:${user.id}`, 1, 10)) {
    res.status(429).json({ error: 'Please wait before starting another render.' }); return;
  }

  const isOwner = String(user.email || '').toLowerCase() === OWNER_EMAIL;
  user.usage = user.usage || {};
  const balance = Number(user.usage.videoCredits || 0);
  if (!isOwner && balance < 1) {
    res.status(402).json({ error: 'Buy a Video Credit before exporting your Reel.', needsCredits: true }); return;
  }

  const title = clean(req.body?.title, 80) || 'Built with Nitro Outreach';
  const subtitle = clean(req.body?.subtitle, 120) || 'Automate your outreach. Grow faster.';
  const style = ['clean', 'bold', 'minimal'].includes(clean(req.body?.style, 20)) ? clean(req.body.style, 20) : 'clean';
  const jobId = `reel_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();
  const job = {
    id: jobId,
    customerId: user.id,
    status: 'awaiting_upload',
    progress: 5,
    title,
    subtitle,
    style,
    chargedCredit: !isOwner,
    createdAt: now,
    updatedAt: now,
  };
  if (!isOwner) user.usage.videoCredits = balance - 1;
  await saveCustomer(user);
  await kv.set(`video:job:${jobId}`, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
  res.status(201).json({
    job,
    uploadUrl: `${process.env.MODAL_RENDER_URL.replace(/\/$/, '')}/render`,
    fields: {
      jobId,
      customerId: user.id,
      token: signJob(jobId, user.id),
      callbackUrl: `${requestOrigin(req)}/api/video-render-callback`,
      downloadBase: process.env.MODAL_RENDER_URL.replace(/\/$/, ''),
      title,
      subtitle,
      style,
    },
    balance: Number(user.usage.videoCredits || 0),
  });
}
