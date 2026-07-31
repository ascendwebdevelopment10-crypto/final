import { currentCustomer, publicCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { planFor, publicPlans } from '../lib/customer-plans.js';
import { createBillingPortalSession, setSubscriptionCancellation, stripeConfigured as hasStripe } from '../lib/stripe.js';

function clean(value, max = 100) { return String(value || '').trim().slice(0, max); }
function nextDate(days) { const date = new Date(Date.now() + days * 86400000); return date.toISOString(); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  const stripeConfigured = hasStripe();
  if (req.method === 'GET') {
    res.status(200).json({
      subscription: user.subscription,
      plan: planFor(user.subscription?.plan),
      plans: publicPlans(),
      invoices: user.invoices || [],
      creditPurchases: user.videoCreditPurchases || [],
      stripeConfigured,
    });
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
    res.status(200).json({ plan, interval, amount, stripeConfigured, checkoutMode: stripeConfigured ? 'stripe' : 'demo' }); return;
  }

  if (action === 'activate-demo') {
    if (stripeConfigured) { res.status(409).json({ error: 'Stripe Checkout is enabled. Continue through the secure payment screen.', code: 'STRIPE_CHECKOUT_ENABLED' }); return; }
    const now = new Date().toISOString();
    user.subscription = plan.id === 'free'
      ? { plan: 'free', interval, status: 'active', billingMode: 'free', cancelAtPeriodEnd: false, startedAt: now }
      : { plan: plan.id, interval, status: 'trialing', billingMode: 'demo', cancelAtPeriodEnd: false, startedAt: now, trialEndsAt: nextDate(14), currentPeriodEnd: nextDate(14) };
    await saveCustomer(user);
    res.status(200).json({ ok: true, subscription: user.subscription, user: publicCustomer(user), redirect: '/checkout/success' }); return;
  }

  if (action === 'cancel') {
    if (user.subscription?.billingMode === 'stripe') {
      if (!stripeConfigured || !user.subscription?.stripeSubscriptionId) {
        res.status(409).json({ error: 'Stripe subscription details are unavailable. Open the billing portal or contact support.' }); return;
      }
      await setSubscriptionCancellation({ stripeSubscriptionId: user.subscription.stripeSubscriptionId, cancelAtPeriodEnd: true });
    }
    user.subscription = { ...(user.subscription || {}), cancelAtPeriodEnd: true, canceledAt: new Date().toISOString() };
    await saveCustomer(user); res.status(200).json({ ok: true, subscription: user.subscription }); return;
  }

  if (action === 'resume') {
    if (user.subscription?.billingMode === 'stripe') {
      if (!stripeConfigured || !user.subscription?.stripeSubscriptionId) {
        res.status(409).json({ error: 'Stripe subscription details are unavailable. Open the billing portal or contact support.' }); return;
      }
      await setSubscriptionCancellation({ stripeSubscriptionId: user.subscription.stripeSubscriptionId, cancelAtPeriodEnd: false });
    }
    user.subscription = { ...(user.subscription || {}), cancelAtPeriodEnd: false, canceledAt: null };
    await saveCustomer(user); res.status(200).json({ ok: true, subscription: user.subscription }); return;
  }

  if (action === 'portal') {
    if (!stripeConfigured || !user.subscription?.stripeCustomerId) {
      res.status(409).json({ error: 'No Stripe billing account is connected yet.' }); return;
    }
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
    const url = await createBillingPortalSession({
      stripeCustomerId: user.subscription.stripeCustomerId,
      returnUrl: `${proto}://${host}/app#billing`,
    });
    res.status(200).json({ url }); return;
  }

  res.status(400).json({ error: 'Unknown billing action' });
}
