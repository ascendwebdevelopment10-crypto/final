// api/master-cron.js - SMS + Email only, calls removed
export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
    : 'https://final-phi-swart.vercel.app';

async function callEndpoint(path) {
    try {
          const res = await fetch(BASE_URL + path, {
                  headers: { Authorization: `Bearer ${CRON_SECRET}` },
                  signal: AbortSignal.timeout(55000)
          });
          const json = await res.json().catch(() => ({ status: res.status }));
          return { path, ok: res.ok, result: json };
    } catch (e) {
          return { path, ok: false, error: e.message };
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
    const auth = req.headers['authorization'];
    if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }

  const started = Date.now();
    const [smsResult, emailResult] = await Promise.all([
          callEndpoint('/api/cron'),
          callEndpoint('/api/email-cron'),
        ]);

  res.status(200).json({
        masterCron: true,
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        tasks: { sms: smsResult, email: emailResult },
  });
}
