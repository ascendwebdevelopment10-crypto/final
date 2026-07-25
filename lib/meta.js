import crypto from 'crypto';

// Meta / Instagram Graph API helpers for customer social publishing.
const V = 'v21.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'];

export function metaConfigured() {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

// --- signed state so the callback can trust which customer started the flow ---
function secret() { return process.env.META_APP_SECRET || process.env.CRON_SECRET || 'dev-secret'; }
export function signState(customerId) {
  const payload = `${customerId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 24);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}
export function verifyState(state) {
  try {
    const decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const [customerId, ts, sig] = decoded.split('.');
    const expected = crypto.createHmac('sha256', secret()).update(`${customerId}.${ts}`).digest('hex').slice(0, 24);
    if (sig !== expected) return null;
    if (Date.now() - Number(ts) > 15 * 60 * 1000) return null; // 15 min window
    return customerId;
  } catch { return null; }
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state,
    scope: SCOPES.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${V}/dialog/oauth?${p}`;
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Meta API error (${r.status})`);
  return j;
}

export async function exchangeCode(code) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code,
  });
  const j = await getJson(`${GRAPH}/oauth/access_token?${p}`);
  return j.access_token;
}

export async function longLivedToken(shortToken) {
  const p = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const j = await getJson(`${GRAPH}/oauth/access_token?${p}`);
  return { token: j.access_token, expiresIn: j.expires_in || null };
}

// Find the first Facebook Page that has a connected Instagram business account.
export async function getIgAccount(token) {
  const pages = await getJson(`${GRAPH}/me/accounts?fields=name,instagram_business_account&access_token=${encodeURIComponent(token)}`);
  const page = (pages.data || []).find(p => p.instagram_business_account?.id);
  if (!page) throw new Error('No Instagram Business account is linked to your Facebook Page. Connect one in Instagram settings, then try again.');
  const igId = page.instagram_business_account.id;
  const info = await getJson(`${GRAPH}/${igId}?fields=username&access_token=${encodeURIComponent(token)}`);
  return { igUserId: igId, igUsername: info.username || '', pageName: page.name || '' };
}

// Publish a single image post to Instagram. Returns the published media id.
export async function publishImage(igUserId, token, caption, imageUrl) {
  if (!imageUrl) throw new Error('Instagram posts require an image.');
  const container = await getJson(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: imageUrl, caption: caption || '', access_token: token }),
  });
  const published = await getJson(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: container.id, access_token: token }),
  });
  return published.id;
}
