import { kv } from '@vercel/kv';

// Public image server — serves a generated image by its (unguessable) id so that
// Instagram's servers can fetch it when publishing. Ids look like "img_<ts>_<rand>".
export default async function handler(req, res) {
  const imgId = String((req.query && req.query.id) || '').slice(0, 80);
  if (!/^img_[0-9]+_[a-z0-9]+$/i.test(imgId)) { res.status(404).end(); return; }
  const b64 = await kv.get('customer:img:' + imgId);
  if (!b64) { res.status(404).end(); return; }
  const buf = Buffer.from(String(b64), 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(buf);
}
