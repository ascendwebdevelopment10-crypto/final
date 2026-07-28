import { currentCustomer } from '../lib/customer-auth.js';
import { kv } from '@vercel/kv';

// Serves a stored AI-generated image (PNG) to its owner. The image id must belong
// to the signed-in customer's own content list.
export default async function handler(req, res) {
  const user = await currentCustomer(req);
  if (!user) { res.status(401).end(); return; }
  const imgId = String((req.query && req.query.id) || '').slice(0, 80);
  const owns = ((user.workspace && user.workspace.content) || []).some(c => c.id === imgId && c.type === 'image');
  if (!owns) { res.status(404).end(); return; }
  const b64 = await kv.get('customer:img:' + imgId);
  if (!b64) { res.status(404).end(); return; }
  const buf = Buffer.from(String(b64), 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.status(200).send(buf);
}
