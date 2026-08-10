import { getCustomer, saveCustomer } from '../lib/customer-auth.js';
import { completeSocialConnection, verifySocialState } from '../lib/social-oauth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const finish = (status, platform = '') => {
    const params = new URLSearchParams({ social: status });
    if (platform) params.set('platform', platform);
    res.writeHead(302, { Location: `/app?${params}#social` }); res.end();
  };
  const checked = verifySocialState(req.query?.state);
  if (!checked) { finish('invalid'); return; }
  if (req.query?.error || !req.query?.code) { finish('denied', checked.platform); return; }
  try {
    const user = await getCustomer(checked.customerId);
    if (!user) { finish('invalid'); return; }
    const connection = await completeSocialConnection(checked.platform, String(req.query.code));
    user.socialConnections = { ...(user.socialConnections || {}), [checked.platform]: connection };
    await saveCustomer(user);
    finish('connected', checked.platform);
  } catch (error) {
    console.error('Social OAuth callback error:', checked.platform, error.message);
    finish('failed', checked.platform);
  }
}
