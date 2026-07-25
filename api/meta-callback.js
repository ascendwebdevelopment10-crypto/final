import { kv } from '@vercel/kv';
import { verifyState, exchangeCode, longLivedToken, getIgAccount } from '../lib/meta.js';

async function loadCustomer(id) {
  let u = await kv.get(`customer:user:${id}`);
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
  return u;
}

// Handle the Meta OAuth redirect: exchange the code, find the IG account, store it on the customer.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { code, state, error, error_description } = req.query || {};
  const done = (msg) => { res.writeHead(302, { Location: `/app#social?meta=${encodeURIComponent(msg)}` }); res.end(); };

  if (error) { done('denied'); return; }
  const customerId = verifyState(state);
  if (!customerId || !code) { done('invalid'); return; }

  try {
    const shortToken = await exchangeCode(String(code));
    const { token, expiresIn } = await longLivedToken(shortToken);
    const account = await getIgAccount(token);
    const user = await loadCustomer(customerId);
    if (!user) { done('nouser'); return; }
    user.meta = {
      igUserId: account.igUserId,
      igUsername: account.igUsername,
      pageName: account.pageName,
      token,
      tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      connectedAt: new Date().toISOString(),
    };
    await kv.set(`customer:user:${customerId}`, user);
    done('connected');
  } catch (e) {
    console.error('Meta callback error:', e.message);
    done('failed');
  }
}
