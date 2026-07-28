import crypto from 'crypto';

// Instagram API with Instagram Login (Business Login) — used for customer publishing.
// Uses the Instagram app credentials and the graph.instagram.com host.
const IG_GRAPH = 'https://graph.instagram.com';
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

function igAppId() { return process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID; }
function igAppSecret() { return process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET; }

export function metaConfigured() {
  return !!(igAppId() && igAppSecret() && process.env.META_REDIRECT_URI);
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
    client_id: igAppId(),
    redirect_uri: process.env.META_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${p}`;
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.error_type) {
    throw new Error((j.error && j.error.message) || j.error_message || `Instagram API error (${r.status})`);
  }
  return j;
}

// Exchange the authorization code for a short-lived token + the Instagram user id.
export async function exchangeCode(code) {
  const r = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: igAppId(),
      client_secret: igAppSecret(),
      grant_type: 'authorization_code',
      redirect_uri: process.env.META_REDIRECT_URI,
      code,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error_type || j.error) {
    throw new Error(j.error_message || (j.error && j.error.message) || `Instagram token error (${r.status})`);
  }
  return { token: j.access_token, userId: String(j.user_id || '') };
}

// Exchange a short-lived token for a long-lived (~60 day) token.
export async function longLivedToken(shortToken) {
  const p = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: igAppSecret(),
    access_token: shortToken,
  });
  const j = await getJson(`${IG_GRAPH}/access_token?${p}`);
  return { token: j.access_token, expiresIn: j.expires_in || null };
}

// Get the connected Instagram account's id + username.
export async function getIgAccount(token) {
  const j = await getJson(`${IG_GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
  return { igUserId: String(j.user_id || j.id || ''), igUsername: j.username || '', pageName: '' };
}

// Publish a single image post to Instagram. Returns the published media id.
// imageUrl must be a publicly accessible URL (Instagram's servers fetch it).
export async function publishImage(igUserId, token, caption, imageUrl) {
  if (!imageUrl) throw new Error('Instagram posts require a public image URL.');
  const container = await getJson(`${IG_GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: imageUrl, caption: caption || '', access_token: token }),
  });
  const published = await getJson(`${IG_GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: container.id, access_token: token }),
  });
  return published.id;
}
