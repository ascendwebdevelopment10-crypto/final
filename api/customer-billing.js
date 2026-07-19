import { currentCustomer, publicCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { planFor, publicPlans } from '../lib/customer-plans.js';

function clean(value, max = 100) { return String(value || '').trim().slice(0, max); }
function nextDate(days) { const date = new Date(Date.now() + days * 86400000); return date.toISOString(); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  if (req.method === 'GET') {
    res.status(200).json({ subscription: user.subscription, plan: planFor(user.subscription?.plan), plans: publicPlans(), invoices: user.invoices || [], stripeConfigured });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const body = req.body || {};
  const action = clean(body.action, 40).toLowerCase();
  const interval = clean(body.interval, 20) === 'yearly' ? 'yearly' : 'monthly';
  const plan = planFor(body.plan);

  if (action === 'review') {
    const amount = interval === 'yearly' ? plan.yearly : plan.monthly;
    res.status(200).json({ plan, interval, amount, stripeConfigured, checkoutMode: stripeConfigured ? 'stripe_setup_required' : 'demo' }); return;
  }

  if (action === 'activate-demo') {
    if (stripeConfigured) { res.status(409).json({ error: 'Stripe is detected. Add Stripe price IDs before enabling live checkout.', code: 'STRIPE_SETUP_REQUIRED' }); return; }
    const now = new Date().toISOString();
    user.subscription = plan.id === 'free'
      ? { plan: 'free', interval, status: 'active', billingMode: 'free', cancelAtPeriodEnd: false, startedAt: now }
      : { plan: plan.id, interval, status: 'trialing', billingMode: 'demo', cancelAtPeriodEnd: false, startedAt: now, trialEndsAt: nextDate(14), currentPeriodEnd: nextDate(14) };
    await saveCustomer(user);
    res.status(200).json({ ok: true, subscription: user.subscription, user: publicCustomer(user), redirect: '/checkout/success' }); return;
  }

  if (action === 'cancel') {
    user.subscription = { ...(user.subscription || {}), cancelAtPeriodEnd: true, canceledAt: new Date().toISOString() };
    await saveCustomer(user); res.status(200).json({ ok: true, subscription: user.subscription }); return;
  }

  if (action === 'resume') {
    user.subscription = { ...(user.subscription || {}), cancelAtPeriodEnd: false, canceledAt: null };
    await saveCustomer(user); res.status(200).json({ ok: true, subscription: user.subscription }); return;
  }

  res.status(400).json({ error: 'Unknown billing action' });
}
