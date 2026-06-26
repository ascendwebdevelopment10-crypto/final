import { getEmailLog, getSmsLog, getTotalStats } from '../lib/store.js';

export default async function handler(req, res) {
  const type = req.query.type || 'stats';
  try {
    if (type === 'stats') {
      const stats = await getTotalStats();
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json(stats);
    } else if (type === 'emails') {
      const limit = parseInt(req.query.limit || '50');
      const log = await getEmailLog(limit);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json(log);
    } else if (type === 'sms') {
      const limit = parseInt(req.query.limit || '50');
      const log = await getSmsLog(limit);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200).json(log);
    } else {
      res.status(400).json({ error: 'Unknown type' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
