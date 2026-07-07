import { kv } from '@vercel/kv';

export default async function handler(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(200).end(); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { key, target } = req.body || {};
        if (key !== process.env.CRON_SECRET && key !== process.env.SUPPRESS_API_SECRET) {
                      res.status(401).json({ error: 'Unauthorized' }); return;
        }

    try {
                  const results = {};

              if (!target || target === 'conversations') {
                                    await kv.del('replies:log');
                                    results.conversations = 'cleared';
              }

              if (!target || target === 'sms_replies') {
                                    await kv.set('stats:sms_replies', 0);
                                    // Also clear replied flag on sms:log entries
                          const smsRaw = await kv.lrange('sms:log', 0, -1);
                                    const smsAll = smsRaw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
                                    const smsUpdated = smsAll.map(e => ({ ...e, replied: false }));
                                    if (smsUpdated.length > 0) {
                                                                    await kv.del('sms:log');
                                                                    for (const e of smsUpdated.reverse()) await kv.lpush('sms:log', JSON.stringify(e));
                                    }
                                    results.sms_replies = 'cleared';
              }

              if (target === 'pipeline') {
                                    await kv.del('pipeline:stages');
                                    results.pipeline = 'cleared';
              }

              // Wipes email sending stats/log entirely. Used when a batch of "sent" emails
              // actually all failed at the provider (e.g. the Resend domain-verification
              // outage) so the dashboard numbers were never real.
              if (target === 'email') {
                                    await kv.set('stats:total_sent', 0);
                                    await kv.del('email:log');
                                    await kv.del('email:opens:count');
                                    await kv.del('email:opens:first');
                                    await kv.del('email:opens:last');
                                    await kv.del('email:clicks:count');
                                    await kv.del('email:clicks:last');
                                    await kv.del('email:clicks:url');
                                    try {
                                                                    const dailyKeys = await kv.keys('stats:daily:*');
                                                                    if (dailyKeys && dailyKeys.length) await kv.del(...dailyKeys);
                                    } catch (e) {
                                                                    console.error('reset-data: could not clear stats:daily:* keys:', e.message);
                                    }
                                    results.email = 'cleared';
              }

              res.status(200).json({ ok: true, results });
    } catch (e) {
                  res.status(500).json({ error: e.message });
    }
}
