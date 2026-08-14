import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';

function clean(value, max = 5000) { return String(value || '').trim().slice(0, max); }
function validFutureDate(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) && ts > Date.now() + 60_000 ? new Date(ts).toISOString() : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['PATCH','DELETE'].includes(req.method)) { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }

  const groupId = clean(req.body?.groupId, 160);
  const id = clean(req.body?.id, 160);
  if (!groupId && !id) { res.status(400).json({ error: 'Missing scheduled post id.' }); return; }
  user.workspace = user.workspace || {};
  const drafts = Array.isArray(user.workspace.socialDrafts) ? user.workspace.socialDrafts : [];

  if (req.method === 'DELETE') {
    let cancelled = 0;
    for (const item of drafts) {
      const matches = groupId ? item.groupId === groupId : item.id === id;
      if (!matches || item.status !== 'scheduled' || Date.parse(item.scheduledFor || 0) <= Date.now()) continue;
      item.status = 'cancelled'; item.cancelledAt = new Date().toISOString(); item.updatedAt = item.cancelledAt; cancelled += 1;
    }
    if (!cancelled) { res.status(404).json({ error: 'That scheduled post could not be found or can no longer be cancelled.' }); return; }
    await saveCustomer(user); res.status(200).json({ ok: true, cancelled }); return;
  }

  const title = req.body?.title === undefined ? null : clean(req.body.title, 180);
  const text = req.body?.text === undefined ? null : clean(req.body.text, 5000);
  const scheduledFor = req.body?.scheduledFor === undefined ? null : validFutureDate(req.body.scheduledFor);
  if (req.body?.scheduledFor !== undefined && !scheduledFor) { res.status(400).json({ error: 'Choose a time at least one minute in the future.' }); return; }
  if (text !== null && !text) { res.status(400).json({ error: 'Post text cannot be empty.' }); return; }

  let updated = 0;
  let matchedGroup = '';
  for (const item of drafts) {
    const matches = groupId ? item.groupId === groupId : item.id === id;
    if (!matches || item.status !== 'scheduled') continue;
    if (Date.parse(item.scheduledFor || 0) <= Date.now()) continue;
    if (title !== null) item.title = title || item.title;
    if (text !== null) item.text = text;
    if (scheduledFor !== null) item.scheduledFor = scheduledFor;
    item.updatedAt = new Date().toISOString();
    matchedGroup = item.groupId || matchedGroup;
    updated += 1;
  }
  if (!updated) { res.status(404).json({ error: 'That scheduled post could not be found or can no longer be edited.' }); return; }
  await saveCustomer(user);
  res.status(200).json({ ok: true, updated, groupId: matchedGroup || groupId || null });
}
