import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { currentCustomer, getCustomer, requestOrigin, saveCustomer } from '../lib/customer-auth.js';
import { exchangeOutlookCode, outlookGraph, saveOutlookTokens } from '../lib/outlook.js';

const SCOPES = 'openid profile email offline_access User.Read Mail.Send Mail.Read';

function redirectUri(req) {
  return String(process.env.OUTLOOK_REDIRECT_URI || `${requestOrigin(req)}/api/outlook-auth`).trim();
}

function appRedirect(res, status, message = '') {
  const params = new URLSearchParams({ outlook: status });
  if (message) params.set('message', message.slice(0, 180));
  res.redirect(302, `/app?${params.toString()}#messages`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const oauthError = String(req.query?.error_description || req.query?.error || '').trim();

    if (oauthError) { appRedirect(res, 'error', oauthError); return; }

    if (code) {
      if (!state) { appRedirect(res, 'error', 'Missing Microsoft sign-in state.'); return; }
      const stateKey = `outlook:oauth:${state}`;
      const userId = await kv.get(stateKey);
      await kv.del(stateKey);
      if (!userId) { appRedirect(res, 'error', 'That Microsoft sign-in expired. Please try again.'); return; }

      const user = await getCustomer(String(userId));
      if (!user) { appRedirect(res, 'error', 'Nitro account not found.'); return; }

      const tokens = await exchangeOutlookCode(code, redirectUri(req));
      await saveOutlookTokens(user.id, tokens);
      const me = await outlookGraph(user.id, '/me?$select=displayName,mail,userPrincipalName');
      const address = String(me.mail || me.userPrincipalName || '').trim().toLowerCase();
      if (!address) throw new Error('Microsoft did not return an email address for this mailbox.');

      user.workspace = user.workspace || {};
      user.workspace.connections = user.workspace.connections || {};
      user.workspace.connections.email = {
        connected: true,
        provider: 'outlook',
        from: address,
        displayName: String(me.displayName || '').trim(),
        connectedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      };
      await saveCustomer(user);
      appRedirect(res, 'connected');
      return;
    }

    const user = await currentCustomer(req);
    if (!user) { res.redirect(302, '/login?next=%2Fapp%23messages'); return; }
    if (!process.env.OUTLOOK_CLIENT_ID || !process.env.OUTLOOK_CLIENT_SECRET || !process.env.OUTLOOK_TOKEN_SECRET) {
      appRedirect(res, 'error', 'Outlook has not been configured by the Nitro owner yet.');
      return;
    }

    const nonce = crypto.randomBytes(32).toString('base64url');
    await kv.set(`outlook:oauth:${nonce}`, String(user.id), { ex: 600 });
    const authorize = new URL(`https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'common'}/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(req),
      response_mode: 'query',
      scope: SCOPES,
      state: nonce,
      prompt: 'select_account',
    }).toString();
    res.redirect(302, authorize.toString());
  } catch (error) {
    console.error('Outlook OAuth error:', error.message);
    appRedirect(res, 'error', error.message || 'Outlook could not be connected.');
  }
}
