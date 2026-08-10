import { kv } from '@vercel/kv';
import { verifyWebhook } from '../lib/stripe.js';
import { notifyBestEffort } from '../lib/ntfy.js';

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

async function saveCustomer(user) {
  user.updatedAt = new Date().toISOString();
  await kv.set(`customer:user:${user.id}`, user);
}

function unixDate(value) {
  return Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : null;
}

function stripeId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

async function customerIdForStripeObject(object) {
  const direct = object?.metadata?.customerId;
  if (direct) return String(direct);
  const stripeCustomerId = stripeId(object?.customer);
  if (!stripeCustomerId) return '';
  const mapped = await kv.get(`stripe:customer:${stripeCustomerId}`);
  return mapped ? String(mapped) : '';
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
        if (s.payment_status !== 'paid') {
          res.status(200).json({ received: true, fulfilled: false });
          return;
        }
        const fulfilledKey = `stripe:fulfilled:${event.id}`;
        const alreadyFulfilled = await kv.get(fulfilledKey);
        if (!alreadyFulfilled) {
          const user = await loadCustomer(customerId);
          const credits = Math.max(0, Math.min(1000, Number(s.metadata?.credits || 0)));
          if (user && credits) {
            const stripeCustomerId = stripeId(s.customer);
            user.usage = user.usage || {};
            user.usage.videoCredits = Number(user.usage.videoCredits || 0) + credits;
            user.subscription = {
              ...(user.subscription || {}),
              stripeCustomerId: stripeCustomerId || user.subscription?.stripeCustomerId || null,
            };
            user.videoCreditPurchases = Array.isArray(user.videoCreditPurchases) ? user.videoCreditPurchases : [];
            user.videoCreditPurchases.unshift({
              stripeSessionId: s.id,
              credits,
              amountTotal: Number(s.amount_total || 0),
              purchasedAt: new Date().toISOString(),
            });
            user.videoCreditPurchases = user.videoCreditPurchases.slice(0, 50);
            await saveCustomer(user);
            if (stripeCustomerId) await kv.set(`stripe:customer:${stripeCustomerId}`, customerId);
            await kv.set(fulfilledKey, '1', { ex: 365 * 24 * 60 * 60 });
          }
        }
        res.status(200).json({ received: true });
        return;
      }
      if (customerId && plan) {
        const user = await loadCustomer(customerId);
        if (user) {
          const stripeCustomerId = stripeId(s.customer);
          const stripeSubscriptionId = stripeId(s.subscription);
          user.subscription = {
            ...(user.subscription || {}),
            plan, interval, status: 'trialing', billingMode: 'stripe',
            cancelAtPeriodEnd: false,
            stripeCustomerId,
            stripeSubscriptionId,
            startedAt: new Date().toISOString(),
          };
          await saveCustomer(user);
          if (stripeCustomerId) await kv.set(`stripe:customer:${stripeCustomerId}`, customerId);
          if (stripeSubscriptionId) await kv.set(`stripe:subscription:${stripeSubscriptionId}`, customerId);
        }
      }
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const customerId = await customerIdForStripeObject(sub) || await kv.get(`stripe:subscription:${sub.id}`);
      const user = customerId ? await loadCustomer(String(customerId)) : null;
      if (user) {
        user.subscription = {
          ...(user.subscription || {}),
          plan: sub.metadata?.plan || user.subscription?.plan || 'free',
          interval: sub.metadata?.interval || user.subscription?.interval || 'monthly',
          status: sub.status || user.subscription?.status || 'active',
          billingMode: 'stripe',
          stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || user.subscription?.stripeCustomerId,
          stripeSubscriptionId: sub.id,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          currentPeriodEnd: unixDate(sub.current_period_end) || user.subscription?.currentPeriodEnd || null,
        };
        await saveCustomer(user);
      }
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const customerId = await customerIdForStripeObject(invoice);
      const user = customerId ? await loadCustomer(customerId) : null;
      if (user) {
        user.invoices = Array.isArray(user.invoices) ? user.invoices : [];
        if (!user.invoices.some(item => item.stripeInvoiceId === invoice.id)) {
          user.invoices.unshift({
            stripeInvoiceId: invoice.id,
            date: unixDate(invoice.created) || new Date().toISOString(),
            number: invoice.number || invoice.id,
            amount: Number(invoice.amount_paid || 0) / 100,
            status: invoice.status || 'paid',
            hostedInvoiceUrl: invoice.hosted_invoice_url || null,
            invoicePdf: invoice.invoice_pdf || null,
          });
          user.invoices = user.invoices.slice(0, 50);
        }
        user.subscription = { ...(user.subscription || {}), status: 'active', billingMode: 'stripe' };
        await saveCustomer(user);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerId = await customerIdForStripeObject(invoice);
      const user = customerId ? await loadCustomer(customerId) : null;
      if (user) {
        user.subscription = { ...(user.subscription || {}), status: 'past_due', billingMode: 'stripe' };
        await saveCustomer(user);
      }
      await notifyBestEffort({ title: 'Nitro payment failed', message: `${user?.email || 'A customer'} has a failed payment${invoice.amount_due ? ` for $${(Number(invoice.amount_due) / 100).toFixed(2)}` : ''}.`, priority: 'urgent', tags: 'warning,credit_card', click: 'https://nitrooutreach.com/dashboard' });
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerId = await customerIdForStripeObject(sub) || await kv.get(`stripe:subscription:${sub.id}`);
      if (customerId) {
        const user = await loadCustomer(String(customerId));
        if (user) {
          user.subscription = { ...(user.subscription || {}), plan: 'free', status: 'canceled', billingMode: 'free' };
          await saveCustomer(user);
        }
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
