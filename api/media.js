import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { kv } from '@vercel/kv';
import { isAuthorized } from '../lib/auth.js';

export const config = { maxDuration: 300 };

const OPENAI_BASE = 'https://api.openai.com/v1';

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function origin(req) {
  const proto = clean(req.headers['x-forwarded-proto'], 20) || 'https';
  const host = clean(req.headers['x-forwarded-host'] || req.headers.host, 300);
  return proto + '://' + host;
}

function signingKey() {
  return process.env.CRON_SECRET || process.env.OPENAI_API_KEY || 'media-unconfigured';
}

function sign(id) {
  return crypto.createHmac('sha256', signingKey()).update(String(id)).digest('hex');
}

function validSignature(id, token) {
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(sign(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function openai(path, options = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured in Vercel');
  const response = await fetch(OPENAI_BASE + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, ...(options.headers || {}) },
  });
  if (!response.ok) {
    let message = 'OpenAI media request failed';
    try { const data = await response.json(); message = data.error?.message || message; } catch {}
    throw new Error(message);
  }
  return response;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.query.id) {
      const id = clean(req.query.id, 100);
      if (!validSignature(id, req.query.token)) { res.status(403).json({ error: 'Invalid media link' }); return; }
      const record = await kv.get('content:media:' + id);
      if (!record) { res.status(404).json({ error: 'Media expired or was not found' }); return; }
      const media = typeof record === 'string' ? JSON.parse(record) : record;
      res.setHeader('Content-Type', media.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Disposition', 'inline; filename="' + (media.filename || 'instagram-image.jpg') + '"');
      res.status(200).send(Buffer.from(media.data, 'base64'));
      return;
    }

    if (req.method === 'GET' && req.query.videoContent) {
      const id = clean(req.query.videoContent, 150);
      if (!validSignature(id, req.query.token)) { res.status(403).json({ error: 'Invalid video link' }); return; }
      const headers = req.headers.range ? { Range: req.headers.range } : {};
      const response = await openai('/videos/' + encodeURIComponent(id) + '/content', { headers });
      res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes');
      if (response.headers.get('content-range')) res.setHeader('Content-Range', response.headers.get('content-range'));
      if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
      res.setHeader('Content-Disposition', 'inline; filename="instagram-reel.mp4"');
      res.status(response.status);
      Readable.fromWeb(response.body).pipe(res);
      return;
    }

    if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

    if (req.method === 'GET' && req.query.videoId) {
      const id = clean(req.query.videoId, 150);
      const response = await openai('/videos/' + encodeURIComponent(id));
      const video = await response.json();
      const payload = { status: video.status, progress: video.progress || 0, error: video.error?.message || '' };
      if (video.status === 'completed') payload.mediaUrl = origin(req) + '/api/media?videoContent=' + encodeURIComponent(id) + '&token=' + sign(id);
      res.status(200).json(payload);
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const action = clean(req.body?.action, 20).toLowerCase();
    const prompt = clean(req.body?.prompt, 5000);
    const title = clean(req.body?.title, 100) || 'instagram-content';
    if (!prompt) { res.status(400).json({ error: 'A media prompt is required' }); return; }

    if (action === 'image') {
      const response = await openai('/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1024', quality: 'medium', output_format: 'jpeg', output_compression: 85 }),
      });
      const data = await response.json();
      const image = data.data?.[0]?.b64_json;
      if (!image) throw new Error('OpenAI did not return an image');
      const id = crypto.randomUUID();
      const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.jpg';
      await kv.set('content:media:' + id, JSON.stringify({ contentType: 'image/jpeg', filename, data: image, createdAt: new Date().toISOString() }), { ex: 7 * 24 * 60 * 60 });
      res.status(200).json({ mediaUrl: origin(req) + '/api/media?id=' + encodeURIComponent(id) + '&token=' + sign(id) });
      return;
    }

    if (action === 'video') {
      const form = new FormData();
      form.append('model', process.env.OPENAI_VIDEO_MODEL || 'sora-2');
      form.append('prompt', prompt);
      form.append('size', '720x1280');
      form.append('seconds', '8');
      const response = await openai('/videos', { method: 'POST', body: form });
      const video = await response.json();
      res.status(202).json({ videoId: video.id, status: video.status || 'queued' });
      return;
    }

    res.status(400).json({ error: 'Unknown media action' });
  } catch (error) {
    console.error('Content media error:', error.message);
    res.status(500).json({ error: error.message || 'Media generation failed' });
  }
}
