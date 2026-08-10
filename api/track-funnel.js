import { currentCustomer } from '../lib/customer-auth.js';
import { recordFunnelEvent } from '../lib/funnel.js';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const BOT_PATTERN = /(bot|crawler|spider|slurp|preview|headless|lighthouse|pagespeed|curl|wget|python-requests|node-fetch|axios)/i;
const CLIENT_STAGES = new Set(['visited', 'engaged', 'signup_viewed', 'signup_started', 'signup_submitted']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().split(':')[0].toLowerCase();
    if (!['nitrooutreach.com', 'www.nitrooutreach.com'].includes(host)) { res.status(200).json({ ok: true, excluded: 'non-production' }); return; }
    const stage = String(req.body?.stage || '').toLowerCase();
    const visitorId = String(req.body?.visitorId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!CLIENT_STAGES.has(stage) || !visitorId) { res.status(400).json({ ok: false }); return; }
    const userAgent = String(req.headers['user-agent'] || '');
    if (BOT_PATTERN.test(userAgent) || req.body?.webdriver === true || req.body?.visibility !== 'visible') { res.status(200).json({ ok: true, excluded: 'automated' }); return; }
    let customer = null;
    try { customer = await currentCustomer(req); } catch {}
    if (String(customer?.email || '').toLowerCase() === OWNER_EMAIL) { res.status(200).json({ ok: true, excluded: 'owner' }); return; }
    const recorded = await recordFunnelEvent(stage, `visitor:${visitorId}`, { path: req.body?.path, source: req.body?.source, email: customer?.email });
    res.status(200).json({ ok: true, recorded });
  } catch { res.status(200).json({ ok: true }); }
}
