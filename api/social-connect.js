import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { signSocialState, socialAuthorizationUrl, validSocialPlatform } from '../lib/social-oauth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  const platform = String(req.method === 'POST' ? req.body?.platform : req.query?.platform || '').toLowerCase();
  if (!validSocialPlatform(platform) && !(req.method === 'POST' && platform === 'instagram')) { res.status(400).json({ error: 'Unsupported social platform' }); return; }
  try {
    if (req.method === 'GET') {
      res.writeHead(302, { Location: socialAuthorizationUrl(platform, signSocialState(user.id, platform)) });
      res.end(); return;
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
      if (String(req.body?.action || '') !== 'disconnect') { res.status(400).json({ error: 'Unknown action' }); return; }
      if (platform === 'instagram') delete user.meta;
      user.socialConnections = { ...(user.socialConnections || {}) };
      delete user.socialConnections[platform];
      await saveCustomer(user);
      res.status(200).json({ ok: true }); return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(503).json({ error: error.message || 'This social connection is not ready yet.' });
  }
}
