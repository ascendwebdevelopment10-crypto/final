import { currentCustomer, requestOrigin, sameOrigin } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';
import { stripeConfigured, createCheckoutSession } from '../lib/stripe.js';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();

// Create a Stripe Checkout session for the signed-in customer's chosen plan.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (!stripeConfigured()) { res.status(503).json({ error: 'Card payments are not enabled yet.', configured: false }); return; }
  if (String(user.email || '').toLowerCase() === OWNER_EMAIL) {
    res.status(403).json({ error: 'Your owner account already has unlimited access and does not need a paid subscription.' });
    return;
  }
  if (user.subscription?.billingMode === 'stripe' && user.subscription?.stripeSubscriptionId) {
    res.status(409).json({ error: 'Manage your existing subscription from Billing to avoid creating a duplicate charge.', code: 'SUBSCRIPTION_EXISTS' });
    return;
  }

  const body = req.body || {};
  const planId = String(body.plan || '').toLowerCase();
  const interval = body.interval === 'yearly' ? 'yearly' : 'monthly';
  const plan = planFor(planId);
  if (!plan || plan.id === 'free') { res.status(400).json({ error: 'Choose a paid plan.' }); return; }

  const amount = interval === 'yearly' ? plan.yearly : plan.monthly;
  const origin = requestOrigin(req);
  try {
    const url = await createCheckoutSession({
      customerId: user.id,
      email: user.email,
      stripeCustomerId: user.subscription?.stripeCustomerId || null,
      plan: plan.id,
      planName: plan.name,
      interval,
      amountCents: Math.round(amount * 100),
      successUrl: `${origin}/app?upgraded=1#billing`,
      cancelUrl: `${origin}/pricing`,
    });
    res.status(200).json({ url });
  } catch (e) {
    console.error('Stripe checkout error:', e.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
