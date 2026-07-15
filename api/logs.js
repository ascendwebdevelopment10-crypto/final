import { isAuthorized } from '../lib/auth.js';
import { getEmailLog, getSmsLog, getTotalStats, getReplies, getCallLog, getEmailEngagement } from '../lib/store.js';

export default async function handler(req, res) {
    const type = req.query.type || 'stats';
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
          if (type === 'stats') {
                  const stats = await getTotalStats();
                  res.status(200).json(stats);
          } else if (type === 'emails') {
                  const limit = parseInt(req.query.limit || '50');
                  const log = await getEmailLog(limit);
                  res.status(200).json(log);
          } else if (type === 'sms') {
                  const limit = parseInt(req.query.limit || '50');
                  const log = await getSmsLog(limit);
                  res.status(200).json(log);
          } else if (type === 'replies') {
                  const limit = parseInt(req.query.limit || '100');
                  const all = await getReplies(limit);
                  const subtype = req.query.subtype;
                  const filtered = subtype
                    ? all.filter(r => subtype === 'sms' ? r.type === 'sms_reply' : r.type !== 'sms_reply')
                            : all;
                  res.status(200).json(filtered);
          } else if (type === 'calls') {
                  const limit = parseInt(req.query.limit || '100');
                  const log = await getCallLog(limit);
                  res.status(200).json(log);
          } else if (type === 'engagement') {
                              const eng = await getEmailEngagement();
                              res.status(200).json(eng);
          } else {
                  res.status(400).json({ error: 'Unknown type' });
          }
    } catch (e) {
          res.status(500).json({ error: e.message });
    }
}
