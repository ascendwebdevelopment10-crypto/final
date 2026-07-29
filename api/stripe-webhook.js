import { kv } from '@vercel/kv';
import { verifyWebhook } from '../lib/stripe.js';

// Stripe needs the raw request body to verify the signature.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function loadCustomer(id) {
  let u = await kv.get(`customer:user:${id}`);
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
  return u;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }
  const body = await rawBody(req);
  const event = verifyWebhook(body, req.headers['stripe-signature']);
  if (!event) { res.status(400).send('Invalid signature'); return; }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const customerId = s.client_reference_id || s.metadata?.customerId;
      const plan = s.metadata?.plan;
      const interval = s.metadata?.interval || 'monthly';
      const purchaseType = s.metadata?.purchaseType;
      if (purchaseType === 'video_credits' && customerId) {
        const fulfilledKey = `stripe:fulfilled:${event.id}`;
        const alreadyFulfilled = await kv.get(fulfilledKey);
        if (!alreadyFulfilled) {
          const user = await loadCustomer(customerId);
          const credits = Math.max(0, Math.min(1000, Number(s.metadata?.credits || 0)));
          if (user && credits) {
            user.usage = user.usage || {};
            user.usage.videoCredits = Number(user.usage.videoCredits || 0) + credits;
            user.videoCreditPurchases = Array.isArray(user.videoCreditPurchases) ? user.videoCreditPurchases : [];
            user.videoCreditPurchases.unshift({
              stripeSessionId: s.id,
              credits,
              amountTotal: Number(s.amount_total || 0),
              purchasedAt: new Date().toISOString(),
            });
            user.videoCreditPurchases = user.videoCreditPurchases.slice(0, 50);
            await kv.set(`customer:user:${customerId}`, user);
            await kv.set(fulfilledKey, '1', { ex: 365 * 24 * 60 * 60 });
          }
        }
        res.status(200).json({ received: true });
        return;
      }
      if (customerId && plan) {
        const user = await loadCustomer(customerId);
        if (user) {
          user.subscription = {
            ...(user.subscription || {}),
            plan, interval, status: 'active', billingMode: 'stripe',
            cancelAtPeriodEnd: false,
            stripeCustomerId: s.customer || null,
            stripeSubscriptionId: s.subscription || null,
            startedAt: new Date().toISOString(),
          };
          await kv.set(`customer:user:${customerId}`, user);
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerId = sub.metadata?.customerId;
      if (customerId) {
        const user = await loadCustomer(customerId);
        if (user) {
          user.subscription = { ...(user.subscription || {}), plan: 'free', status: 'canceled', billingMode: 'free' };
          await kv.set(`customer:user:${customerId}`, user);
        }
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e.message);
    res.status(200).json({ received: true }); // ack to avoid retries storm
  }
}
