import { logReply } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const event = req.body;
    const type = event?.type;
    if (type === 'email.replied' || type === 'inbound.email') {
      const from = event?.data?.from || event?.from || '';
      const subject = event?.data?.subject || event?.subject || '';
      const body = event?.data?.text || event?.data?.html || event?.text || event?.html || '';
      const originalTo = event?.data?.to?.[0] || event?.to || '';
      await logReply({ from, subject, body, timestamp: Date.now(), originalTo });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
