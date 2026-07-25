import { currentCustomer } from '../lib/customer-auth.js';
import { metaConfigured, signState, authUrl } from '../lib/meta.js';

// Start the Instagram/Meta OAuth flow for the signed-in customer.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).send('Please sign in first.'); return; }
  if (!metaConfigured()) {
    res.status(503).send('Instagram connection is not configured yet. (Missing Meta app credentials.)'); return;
  }
  const url = authUrl(signState(user.id));
  res.writeHead(302, { Location: url });
  res.end();
}
