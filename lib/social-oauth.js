import crypto from 'crypto';

const REDIRECT_URI = process.env.SOCIAL_REDIRECT_URI || 'https://nitrooutreach.com/api/social-callback';
const SUPPORTED = new Set(['facebook', 'tiktok', 'linkedin', 'youtube']);

function stateSecret() {
  return process.env.OAUTH_STATE_SECRET || process.env.CUSTOMER_AUTH_SECRET || process.env.CRON_SECRET || '';
}

function credentials(platform) {
  if (platform === 'facebook') return { id: process.env.FACEBOOK_APP_ID || process.env.META_APP_ID, secret: process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET };
  if (platform === 'tiktok') return { id: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET };
  if (platform === 'linkedin') return { id: process.env.LINKEDIN_CLIENT_ID, secret: process.env.LINKEDIN_CLIENT_SECRET };
  if (platform === 'youtube') return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  return {};
}

export function validSocialPlatform(platform) { return SUPPORTED.has(String(platform || '').toLowerCase()); }

export function socialProviderStatus() {
  return Object.fromEntries([...SUPPORTED].map(platform => {
    const creds = credentials(platform);
    return [platform, Boolean(creds.id && creds.secret && stateSecret())];
  }));
}

export function signSocialState(customerId, platform) {
  if (!stateSecret() || !validSocialPlatform(platform)) throw new Error('Social connection security is not configured.');
  const payload = `${customerId}.${platform}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  const signature = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

export function verifySocialState(value) {
  try {
    const decoded = Buffer.from(String(value || ''), 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 5) return null;
    const [customerId, platform, timestamp, nonce, ...signatureParts] = parts;
    const signature = signatureParts.join('.');
    const payload = `${customerId}.${platform}.${timestamp}.${nonce}`;
    const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    if (!validSocialPlatform(platform) || Date.now() - Number(timestamp) > 15 * 60 * 1000) return null;
    return { customerId, platform };
  } catch { return null; }
}

export function socialAuthorizationUrl(platform, state) {
  const creds = credentials(platform);
  if (!creds.id || !creds.secret) throw new Error(`${platform} connection is not configured yet.`);
  if (platform === 'facebook') {
    const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
    const params = new URLSearchParams({ client_id: creds.id, redirect_uri: REDIRECT_URI, state, response_type: 'code', scope: 'pages_show_list,pages_read_engagement,pages_manage_posts' });
    return `https://www.facebook.com/${version}/dialog/oauth?${params}`;
  }
  if (platform === 'tiktok') {
    const params = new URLSearchParams({ client_key: creds.id, redirect_uri: REDIRECT_URI, state, response_type: 'code', scope: 'user.info.basic' });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  }
  if (platform === 'linkedin') {
    const params = new URLSearchParams({ client_id: creds.id, redirect_uri: REDIRECT_URI, state, response_type: 'code', scope: 'openid profile w_member_social' });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  }
  const params = new URLSearchParams({ client_id: creds.id, redirect_uri: REDIRECT_URI, state, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: 'openid profile email https://www.googleapis.com/auth/youtube.upload' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error_description || data.error?.message || data.error || `Social provider request failed (${response.status})`);
  return data;
}

export async function completeSocialConnection(platform, code) {
  const creds = credentials(platform);
  let tokenData, profile;
  if (platform === 'facebook') {
    const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
    const tokenParams = new URLSearchParams({ client_id: creds.id, client_secret: creds.secret, redirect_uri: REDIRECT_URI, code });
    tokenData = await jsonRequest(`https://graph.facebook.com/${version}/oauth/access_token?${tokenParams}`);
    const [member, pages] = await Promise.all([
      jsonRequest(`https://graph.facebook.com/${version}/me?fields=id,name&access_token=${encodeURIComponent(tokenData.access_token)}`),
      jsonRequest(`https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(tokenData.access_token)}`),
    ]);
    const page = pages.data?.[0] || null;
    profile = { accountId: member.id, accountName: page?.name || member.name || 'Facebook', pageId: page?.id || '', pageAccessToken: page?.access_token || '' };
  } else if (platform === 'tiktok') {
    tokenData = await jsonRequest('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: creds.id, client_secret: creds.secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }) });
    const user = await jsonRequest('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    profile = { accountId: user.data?.user?.open_id || tokenData.open_id || '', accountName: user.data?.user?.display_name || 'TikTok' };
  } else if (platform === 'linkedin') {
    tokenData = await jsonRequest('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: creds.id, client_secret: creds.secret, redirect_uri: REDIRECT_URI }) });
    const user = await jsonRequest('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    profile = { accountId: user.sub || '', accountName: user.name || 'LinkedIn' };
  } else {
    tokenData = await jsonRequest('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: creds.id, client_secret: creds.secret, redirect_uri: REDIRECT_URI }) });
    const channel = await jsonRequest('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const item = channel.items?.[0];
    profile = { accountId: item?.id || '', accountName: item?.snippet?.title || 'YouTube' };
  }
  return {
    platform, connected: true, ...profile,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || '',
    tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null,
    connectedAt: new Date().toISOString(),
  };
}
