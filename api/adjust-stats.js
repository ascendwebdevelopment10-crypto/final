import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

// Manual stat adjustments — e.g. backfilling sends that Resend delivered but
// logEmail never recorded. POST { key, emails: N } (and/or sms: N).
// Increments both the all-time total and today's daily counter.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { key, emails, sms } = req.body || {};
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const results = {};
    const nEmails = parseInt(emails, 10);
    if (Number.isFinite(nEmails) && nEmails !== 0) {
      results.total_sent = await kv.incrby('stats:total_sent', nEmails);
      results.today_sent = await kv.incrby('stats:daily:' + today, nEmails);
    }
    const nSms = parseInt(sms, 10);
    if (Number.isFinite(nSms) && nSms !== 0) {
      results.sms_total_sent = await kv.incrby('stats:sms_total_sent', nSms);
      results.sms_today_sent = await kv.incrby('stats:sms_daily:' + today, nSms);
    }
    res.status(200).json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
