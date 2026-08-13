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
      const action = String(req.body?.action || '');
      if (action === 'select_page' && platform === 'facebook') {
        const connection = user.socialConnections?.facebook;
        const page = connection?.availablePages?.find(item => String(item.id) === String(req.body?.pageId || ''));
        if (!page) { res.status(404).json({ error: 'That Facebook Page is not available. Reconnect Facebook and try again.' }); return; }
        user.socialConnections.facebook = { ...connection, pageId: page.id, pageAccessToken: page.accessToken, accountName: page.name, connected: true };
        await saveCustomer(user);
        res.status(200).json({ ok: true }); return;
      }
      if (action !== 'disconnect') { res.status(400).json({ error: 'Unknown action' }); return; }
      if (platform === 'instagram') delete user.meta;
      user.socialConnections = { ...(user.socialConnections || {}) };
      const connection = user.socialConnections[platform];
      if (connection) {
        try {
          if (platform === 'youtube') await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.refreshToken || connection.accessToken)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
          else if (platform === 'tiktok') await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY || '', client_secret: process.env.TIKTOK_CLIENT_SECRET || '', token: connection.accessToken || '' }) });
          else if (platform === 'facebook') await fetch(`https://graph.facebook.com/me/permissions?access_token=${encodeURIComponent(connection.accessToken || '')}`, { method: 'DELETE' });
        } catch (error) { console.warn('Social provider revoke failed:', platform, error.message); }
      }
      delete user.socialConnections[platform];
      await saveCustomer(user);
      res.status(200).json({ ok: true }); return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(503).json({ error: error.message || 'This social connection is not ready yet.' });
  }
}
