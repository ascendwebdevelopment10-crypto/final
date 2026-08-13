import { kv } from '@vercel/kv';

const ENDPOINT = 'https://nitrooutreach.com/webhook';
const EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.suppressed', 'email.received'];
const CACHE_KEY = 'outreach:resend:webhook-active';

export async function ensureOutreachWebhook() {
  if (!process.env.RESEND_API_KEY) return { status: 'missing_api_key' };
  if (await kv.get(CACHE_KEY)) return { status: 'active' };
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'Nitro-Outreach/1.0' };
  const failure = async (response, operation) => {
    const body = await response.json().catch(() => ({}));
    const restricted = response.status === 401 || response.status === 403;
    return {
      status: restricted ? 'restricted_api_key' : response.status === 429 ? 'rate_limited' : 'unavailable',
      operation,
      httpStatus: response.status,
      reason: restricted
        ? 'The Resend key can send email but cannot manage webhooks. Replace it with a full-access key.'
        : String(body?.message || body?.error?.message || `Resend returned HTTP ${response.status}`).slice(0, 180),
    };
  };
  try {
    const listResponse = await fetch('https://api.resend.com/webhooks', { headers });
    if (!listResponse.ok) return failure(listResponse, 'list');
    const list = await listResponse.json();
    const existing = (list.data || []).find(webhook => webhook.endpoint === ENDPOINT);
    if (existing) {
      const hasEveryEvent = EVENTS.every(event => (existing.events || []).includes(event));
      if (existing.status !== 'enabled' || !hasEveryEvent) {
        const updateResponse = await fetch(`https://api.resend.com/webhooks/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ endpoint: ENDPOINT, events: EVENTS, status: 'enabled' }),
        });
        if (!updateResponse.ok) return failure(updateResponse, 'update');
      }
      const detailResponse = await fetch(`https://api.resend.com/webhooks/${encodeURIComponent(existing.id)}`, { headers });
      if (detailResponse.ok) {
        const detail = await detailResponse.json();
        if (detail.signing_secret) await kv.set('outreach:resend:webhook-secret', detail.signing_secret);
      }
    } else {
      const createResponse = await fetch('https://api.resend.com/webhooks', {
        method: 'POST', headers,
        body: JSON.stringify({ endpoint: ENDPOINT, events: EVENTS }),
      });
      if (!createResponse.ok) return failure(createResponse, 'create');
      const created = await createResponse.json();
      if (created.signing_secret) await kv.set('outreach:resend:webhook-secret', created.signing_secret);
    }
    await kv.set(CACHE_KEY, '1', { ex: 21600 });
    return { status: 'active' };
  } catch (error) {
    return { status: 'unavailable', reason: String(error?.message || 'Webhook management request failed.').slice(0, 180) };
  }
}
