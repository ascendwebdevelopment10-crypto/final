import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

const VALID_STAGES = ['new_lead','contacted','replied','interested','meeting_booked','client','lost'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(200).end(); return; }

          if (!isAuthorized(req)) {
                res.status(401).json({ error: 'Unauthorized' }); return;
                  }

                    if (req.method === 'POST') {
                        const { contact, stage, note } = req.body || {};
                            if (!contact || !stage) { res.status(400).json({ error: 'Missing contact or stage' }); return; }
                                if (!VALID_STAGES.includes(stage)) { res.status(400).json({ error: 'Invalid stage' }); return; }

                                    function normPhone(s) {
                                          const d = String(s || '').replace(/[^0-9]/g, '');
                                                return d.length >= 10 ? d.slice(-10) : d;
                                                    }
                                                        function isPhone(s) { return String(s || '').replace(/[^0-9]/g, '').length >= 7; }
                                                            function getKey(s) {
                                                                  if (!s) return '';
                                                                        if (isPhone(s)) return normPhone(s);
                                                                              return String(s).toLowerCase().trim();
                                                                                  }

                                                                                      const contactKey = getKey(contact);
                                                                                          const pipelineRaw = await kv.get('pipeline:stages') || '{}';
                                                                                              const pipeline = typeof pipelineRaw === 'string' ? JSON.parse(pipelineRaw) : pipelineRaw;

                                                                                                  const prev = pipeline[contactKey];
                                                                                                      pipeline[contactKey] = {
                                                                                                            contact,
                                                                                                                  stage,
                                                                                                                        updatedAt: Date.now(),
                                                                                                                              note: note || '',
                                                                                                                                    history: [...(prev?.history || []), { stage: prev?.stage || 'new_lead', ts: prev?.updatedAt || Date.now() }]
                                                                                                                                        };
                                                                                                                                            await kv.set('pipeline:stages', JSON.stringify(pipeline));
                                                                                                                                                res.status(200).json({ ok: true, contactKey, stage });
                                                                                                                                                
                                                                                                                                                  } else if (req.method === 'GET') {
                                                                                                                                                      const raw = await kv.get('pipeline:stages') || '{}';
                                                                                                                                                          const pipeline = typeof raw === 'string' ? JSON.parse(raw) : raw;
                                                                                                                                                              res.status(200).json(pipeline);
                                                                                                                                                                } else {
                                                                                                                                                                    res.status(405).json({ error: 'Method not allowed' });
                                                                                                                                                                      }
                                                                                                                                                                      }
