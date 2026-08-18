import { getCustomer, saveCustomer } from '../lib/customer-auth.js';
import { completeSocialConnection, verifySocialState } from '../lib/social-oauth.js';

function cleanMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const finish = (status, platform = '', message = '') => {
    const params = new URLSearchParams({ social: status });
    if (platform) params.set('platform', platform);
    if (message) params.set('message', cleanMessage(message));
    res.writeHead(302, { Location: `/app?${params}#social` });
    res.end();
  };

  const checked = verifySocialState(req.query?.state);
  if (!checked) { finish('invalid', '', 'The social connection session expired. Please try connecting again.'); return; }

  if (req.query?.error || !req.query?.code) {
    const reason = req.query?.error_description || req.query?.error_message || req.query?.error_reason || req.query?.error || 'The connection was cancelled or denied.';
    finish('denied', checked.platform, reason);
    return;
  }

  try {
    const user = await getCustomer(checked.customerId);
    if (!user) { finish('invalid', checked.platform, 'Your Nitro session could not be found. Please sign in and try again.'); return; }

    const connection = await completeSocialConnection(checked.platform, String(req.query.code));
    if (!connection?.connected || !connection?.accountId) {
      throw new Error(`${checked.platform} did not return a usable account.`);
    }
    if (checked.platform === 'facebook' && (!connection.pageId || !connection.pageAccessToken)) {
      throw new Error('Facebook connected, but Nitro could not access a Page you manage. Make sure you select a Facebook Page and grant the requested Page permissions.');
    }

    user.socialConnections = { ...(user.socialConnections || {}), [checked.platform]: connection };
    await saveCustomer(user);
    finish('connected', checked.platform, `${checked.platform} connected successfully.`);
  } catch (error) {
    console.error('Social OAuth callback error:', checked.platform, error.message);
    finish('failed', checked.platform, error.message || 'The social provider could not complete the connection.');
  }
}
