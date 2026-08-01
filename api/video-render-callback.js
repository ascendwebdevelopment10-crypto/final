import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { getCustomer, saveCustomer } from '../lib/customer-auth.js';

function clean(value, max = 2000) { return String(value || '').trim().slice(0, max); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function inspectRemoteOutput(outputUrl, reportedDuration, requestedDuration) {
  const checks = { trustedRenderer: false, reachable: false, mp4: false, fileHealthy: false, durationComplete: false };
  try {
    const output = new URL(outputUrl);
    const renderer = new URL(process.env.MODAL_RENDER_URL || 'https://invalid.local');
    checks.trustedRenderer = output.protocol === 'https:' && output.origin === renderer.origin && output.pathname.startsWith('/download/');
    if (!checks.trustedRenderer) return { passed: false, checks };
    const head = await fetch(output, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
    checks.reachable = head.ok;
    const size = Number(head.headers.get('content-length') || 0);
    checks.fileHealthy = size >= 250_000;
    const sample = await fetch(output, { headers: { Range: 'bytes=0-63' }, signal: AbortSignal.timeout(12000) });
    if (sample.ok) {
      checks.reachable = true;
      const rangeTotal = Number((sample.headers.get('content-range') || '').split('/').pop() || 0);
      if (!checks.fileHealthy) checks.fileHealthy = rangeTotal >= 250_000 || Number(sample.headers.get('content-length') || 0) >= 250_000;
      const reader = sample.body?.getReader();
      const first = reader ? await reader.read() : { value: new Uint8Array(), done: true };
      const bytes = Buffer.from(first.value || []).subarray(0, 64);
      if (reader && !first.done) await reader.cancel();
      checks.mp4 = bytes.length >= 12 && bytes.subarray(4, 12).toString('latin1').includes('ftyp');
    }
    const actualDuration = Number(reportedDuration || 0);
    checks.durationComplete = Number.isFinite(actualDuration) && actualDuration >= Number(requestedDuration || 15) - 0.35;
    return { passed: Object.values(checks).every(Boolean), checks, sizeBytes: size, duration: actualDuration, inspectedBy: 'Nitro Vercel callback' };
  } catch (error) {
    return { passed: false, checks, error: clean(error.message, 180) };
  }
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

  const quality = status === 'completed'
    ? await inspectRemoteOutput(outputUrl, req.body?.actualDuration, job.duration)
    : { passed: false, checks: {} };
  const qualityPassed = quality.passed && req.body?.qualityPassed !== false;
  job.status = status === 'completed' && qualityPassed ? 'completed' : 'failed';
  job.progress = job.status === 'completed' ? 100 : 0;
  job.outputUrl = job.status === 'completed' ? outputUrl : '';
  job.actualDuration = job.status === 'completed'
    ? Math.max(1, Number(req.body?.actualDuration || job.duration))
    : job.duration;
  job.error = job.status === 'failed'
    ? 'Nitro did not approve this Reel’s quality. No credit was charged—please try again.'
    : '';
  job.quality = { ...quality, renderer: req.body?.quality && typeof req.body.quality === 'object' ? req.body.quality : null };
  job.updatedAt = new Date().toISOString();
  const user = await getCustomer(job.customerId);
  if (user) {
    user.usage = user.usage || {};
    const reservation = Number(job.reservedCredits || 0);
    user.usage.reservedVideoCredits = Math.max(0, Number(user.usage.reservedVideoCredits || 0) - reservation);
    if (job.status === 'failed' && Number(job.chargedCredits || (job.chargedCredit ? 1 : 0)) > 0 && !job.refunded) {
      user.usage.videoCredits = Number(user.usage.videoCredits || 0) + Number(job.chargedCredits || 1);
      job.refunded = true;
    }
    if (job.status === 'completed' && reservation > 0) {
      user.usage.videoCredits = Math.max(0, Number(user.usage.videoCredits || 0) - reservation);
      job.chargedCredits = reservation;
      job.reservedCredits = 0;
    }
  }
  if (job.status === 'completed') {
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
  } else if (user) {
    job.reservedCredits = 0;
    await saveCustomer(user);
  }
  await kv.set(`video:job:${jobId}`, JSON.stringify(job), { ex: 7 * 24 * 60 * 60 });
  res.status(200).json({ ok: true });
}
