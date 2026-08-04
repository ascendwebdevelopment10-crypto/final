import { kv } from '@vercel/kv';

const ENDPOINT = 'https://nitrooutreach.com/webhook';
const EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.suppressed', 'email.received'];
const CACHE_KEY = 'outreach:resend:webhook-active';

export async function ensureOutreachWebhook() {
  if (!process.env.RESEND_API_KEY) return { status: 'missing_api_key' };
  if (await kv.get(CACHE_KEY)) return { status: 'active' };
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' };
  try {
    const listResponse = await fetch('https://api.resend.com/webhooks', { headers });
    if (!listResponse.ok) return { status: 'unavailable' };
    const list = await listResponse.json();
    const existing = (list.data || []).find(webhook => webhook.endpoint === ENDPOINT);
    if (existing) {
      const hasEveryEvent = EVENTS.every(event => (existing.events || []).includes(event));
      if (existing.status !== 'enabled' || !hasEveryEvent) {
        const updateResponse = await fetch(`https://api.resend.com/webhooks/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ endpoint: ENDPOINT, events: EVENTS, status: 'enabled' }),
        });
        if (!updateResponse.ok) return { status: 'unavailable' };
      }
    } else {
      const createResponse = await fetch('https://api.resend.com/webhooks', {
        method: 'POST', headers,
        body: JSON.stringify({ endpoint: ENDPOINT, events: EVENTS }),
      });
      if (!createResponse.ok) return { status: 'unavailable' };
      const created = await createResponse.json();
      if (created.signing_secret) await kv.set('outreach:resend:webhook-secret', created.signing_secret);
    }
    await kv.set(CACHE_KEY, '1', { ex: 21600 });
    return { status: 'active' };
  } catch {
    return { status: 'unavailable' };
  }
}
