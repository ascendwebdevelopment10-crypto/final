import { notifyNtfy, saveNtfyConfig } from '../lib/ntfy.js';

const ONE_TIME_SETUP_KEY = 'nitro-ntfy-setup-6f9c1b84a7e24d2e';

export default async function handler(req, res) {
  if (req.method !== 'POST' || req.headers['x-setup-key'] !== ONE_TIME_SETUP_KEY) { res.status(404).end(); return; }
  try {
    await saveNtfyConfig({ server: 'https://ntfy.sh', topic: 'nitro-alerts-ty-8x4kq7m2vp9z' });
    const result = await notifyNtfy({ title: 'Nitro notifications connected', message: 'This is a verified test from Nitro production.', priority: 'high', tags: 'white_check_mark,zap', click: 'https://nitrooutreach.com/app' });
    res.status(200).json({ ok: true, messageId: result?.id || null });
  } catch (error) {
    console.error('ntfy setup failed:', error.message);
    res.status(502).json({ ok: false, error: error.message });
  }
}
