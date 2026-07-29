import crypto from 'crypto';

// Stripe helpers using the REST API directly (no SDK dependency).
const API = 'https://api.stripe.com/v1';

export function stripeConfigured() { return !!process.env.STRIPE_SECRET_KEY; }

async function stripePost(path, params) {
  const body = new URLSearchParams(params);
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Stripe error (${r.status})`);
  return j;
}

// Create a subscription Checkout Session for a plan. amountCents + interval drive a dynamic price.
export async function createCheckoutSession({ customerId, email, plan, planName, interval, amountCents, successUrl, cancelUrl }) {
  const params = {
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Nitro Outreach — ${planName}`,
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][recurring][interval]': interval === 'yearly' ? 'year' : 'month',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: customerId,
    'metadata[plan]': plan,
    'metadata[interval]': interval,
    'subscription_data[metadata][customerId]': customerId,
    'subscription_data[metadata][plan]': plan,
  };
  if (email) params.customer_email = email;
  const session = await stripePost('/checkout/sessions', params);
  return session.url;
}

// Sell prepaid render credits. Keeping rendering prepaid guarantees that a
// customer's export is funded before Nitro starts paid compute.
export async function createVideoCreditCheckoutSession({ customerId, email, credits, amountCents, successUrl, cancelUrl }) {
  const params = {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Nitro Video Credits — ${credits} Reel exports`,
    'line_items[0][price_data][unit_amount]': String(amountCents),
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: customerId,
    customer_creation: 'always',
    'metadata[purchaseType]': 'video_credits',
    'metadata[customerId]': customerId,
    'metadata[credits]': String(credits),
  };
  if (email) params.customer_email = email;
  const session = await stripePost('/checkout/sessions', params);
  return session.url;
}

// Verify a Stripe webhook signature and return the parsed event, or null if invalid.
export function verifyWebhook(rawBody, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return null;
  try {
    const parts = Object.fromEntries(String(sigHeader).split(',').map(kv => kv.split('=')));
    const signed = `${parts.t}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    const ok = parts.v1 && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
    if (!ok) return null;
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return null; // 5-min tolerance
    return JSON.parse(rawBody);
  } catch { return null; }
}
