import crypto from 'node:crypto';
import { kv } from '@vercel/kv';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'common'}/oauth2/v2.0/token`;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function tokenKey() {
  return crypto.createHash('sha256').update(required('OUTLOOK_TOKEN_SECRET')).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

function decrypt(payload) {
  const stored = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!stored?.iv || !stored?.tag || !stored?.data) throw new Error('The saved Outlook connection is invalid. Reconnect Outlook.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(stored.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(stored.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8'));
}

export async function saveOutlookTokens(userId, tokenResponse, previous = {}) {
  const bundle = {
    accessToken: tokenResponse.access_token || previous.accessToken || '',
    refreshToken: tokenResponse.refresh_token || previous.refreshToken || '',
    expiresAt: Date.now() + Math.max(60, Number(tokenResponse.expires_in || 3600) - 90) * 1000,
    scope: tokenResponse.scope || previous.scope || '',
  };
  if (!bundle.accessToken || !bundle.refreshToken) throw new Error('Microsoft did not return a reusable mailbox connection. Please approve offline access and try again.');
  await kv.set(`outlook:tokens:${userId}`, JSON.stringify(encrypt(bundle)));
  return bundle;
}

export async function deleteOutlookTokens(userId) {
  await kv.del(`outlook:tokens:${userId}`);
}

async function loadOutlookTokens(userId) {
  const payload = await kv.get(`outlook:tokens:${userId}`);
  if (!payload) throw new Error('Outlook is not connected.');
  return decrypt(payload);
}

async function tokenRequest(params) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || `Microsoft token error ${response.status}`);
  return data;
}

export async function exchangeOutlookCode(code, redirectUri) {
  return tokenRequest({
    client_id: required('OUTLOOK_CLIENT_ID'),
    client_secret: required('OUTLOOK_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access User.Read Mail.Send Mail.Read',
  });
}

export async function getOutlookAccessToken(userId) {
  const bundle = await loadOutlookTokens(userId);
  if (bundle.accessToken && Number(bundle.expiresAt || 0) > Date.now()) return bundle.accessToken;
  const refreshed = await tokenRequest({
    client_id: required('OUTLOOK_CLIENT_ID'),
    client_secret: required('OUTLOOK_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: bundle.refreshToken,
    scope: 'openid profile email offline_access User.Read Mail.Send Mail.Read',
  });
  return (await saveOutlookTokens(userId, refreshed, bundle)).accessToken;
}

export async function outlookGraph(userId, path, options = {}) {
  const accessToken = await getOutlookAccessToken(userId);
  const response = await fetch(path.startsWith('http') ? path : `${GRAPH_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 202 || response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Microsoft Graph error ${response.status}`);
  return data;
}

export async function sendOutlookEmail(userId, { to, subject, body }) {
  await outlookGraph(userId, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
}

export async function getRecentInboxMessages(userId) {
  const query = '/me/mailFolders/inbox/messages?$top=50&$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,internetMessageId&$orderby=receivedDateTime%20desc';
  const data = await outlookGraph(userId, query);
  return Array.isArray(data.value) ? data.value : [];
}
