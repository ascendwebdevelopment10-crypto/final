import { kv } from '@vercel/kv';
import { getCustomer, saveCustomer } from '../lib/customer-auth.js';

export const config = { maxDuration: 30 };

function clean(value, max = 8000) { return String(value || '').trim().slice(0, max); }

// Per-customer webhook: a connected email/SMS provider POSTs each send or reply here
// and it is logged automatically into that customer's Messaging log.
// Auth is the durable token issued when the customer connects an account.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const token = clean(req.query?.token || req.body?.token, 200);
  if (!token) { res.status(400).json({ error: 'Missing token' }); return; }

  const userId = await kv.get('customer:msghook:' + token);
  if (!userId) { res.status(401).json({ error: 'Invalid token' }); return; }

  const user = await getCustomer(String(userId));
  if (!user) { res.status(404).json({ error: 'Account not found' }); return; }

  const b = req.body || {};
  const channel = clean(b.channel, 10).toLowerCase() === 'sms' ? 'sms' : 'email';
  const to = clean(b.to, 200);
  const bodyText = clean(b.body || b.text || b.message, channel === 'sms' ? 1200 : 8000);
  if (!to || !bodyText) { res.status(400).json({ error: 'Missing to or body' }); return; }

  const statusIn = clean(b.status, 20).toLowerCase();
  const status = statusIn === 'reply' ? 'reply' : (statusIn === 'scheduled' ? 'scheduled' : 'sent');

  user.workspace = user.workspace || {};
  if (!Array.isArray(user.workspace.messages)) user.workspace.messages = [];
  const entry = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    channel, to,
    subject: channel === 'email' ? (clean(b.subject, 240) || '(no subject)') : '',
    body: bodyText,
    status,
    createdAt: new Date().toISOString(),
  };
  user.workspace.messages.unshift(entry);
  user.workspace.messages = user.workspace.messages.slice(0, 200);
  await saveCustomer(user);

  res.status(200).json({ ok: true, id: entry.id });
}
