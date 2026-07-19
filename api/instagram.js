import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { isAuthorized } from '../lib/auth.js';

export const config = { maxDuration: 60 };

// Production redeploy marker: load dedicated Instagram OAuth credentials.

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = 'https://graph.instagram.com/' + GRAPH_VERSION;
// Instagram Login has its own platform credentials. A Facebook/Meta App ID
// from App Settings > Basic is not a valid client ID for this OAuth flow.
const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const PROFILE_DEFAULTS = {
  displayName: 'Ascend Outreach | AI Growth System',
  handle: '@ascendoutreachsystem',
  bio: 'AI-powered outreach, content, audits & proposals.\nBuilt for agencies and service businesses.\n↓ See the platform',
  profileUrl: 'https://final-phi-swart.vercel.app/dashboard'
};

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function origin(req) {
  const proto = clean(req.headers['x-forwarded-proto'], 20) || 'https';
  const host = clean(req.headers['x-forwarded-host'] || req.headers.host, 300);
  return proto + '://' + host;
}

function redirectUri(req) {
  return process.env.INSTAGRAM_REDIRECT_URI || 'https://final-phi-swart.vercel.app/api/instagram-callback';
}

async function graph(path, options = {}) {
  const response = await fetch(GRAPH + path, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Instagram API request failed');
  return data;
}

async function connection() {
  const value = await kv.get('instagram:connection');
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function profile() {
  const value = await kv.get('instagram:profile');
  const saved = (typeof value === 'string' ? JSON.parse(value) : value) || {};
  return { ...PROFILE_DEFAULTS, ...saved };
}

function sameHost(req, mediaUrl) {
  try { return new URL(mediaUrl).host === new URL(origin(req)).host && new URL(mediaUrl).protocol === 'https:'; } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = clean(req.query?.action || req.body?.action, 40).toLowerCase();

    if (req.method === 'GET' && action === 'callback') {
      const state = clean(req.query.state, 160);
      const code = clean(req.query.code, 2000);
      const saved = await kv.get('instagram:oauth:' + state);
      if (!state || !code || !saved) throw new Error('Instagram authorization expired. Please try connecting again.');
      await kv.del('instagram:oauth:' + state);
      const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: APP_ID,
          client_secret: APP_SECRET,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri(req),
          code
        })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_message || tokenData.error?.message || 'Instagram token exchange failed');
      let userToken = tokenData.access_token;
      let expiresIn = tokenData.expires_in || 3600;
      try {
        const longParams = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: APP_SECRET, access_token: userToken });
        const longResponse = await fetch('https://graph.instagram.com/access_token?' + longParams.toString());
        const longData = await longResponse.json();
        if (longResponse.ok && longData.access_token) {
          userToken = longData.access_token;
          expiresIn = longData.expires_in || expiresIn;
        }
      } catch {}
      const account = await graph('/me?fields=id,user_id,username,name,profile_picture_url,account_type&access_token=' + encodeURIComponent(userToken));
      const igUserId = String(account.user_id || account.id || tokenData.user_id || '');
      if (!igUserId) throw new Error('Instagram did not return a professional account ID.');
      const username = account.username || 'ascendoutreachsystem';
      await kv.set('instagram:connection', JSON.stringify({
        igUserId,
        username,
        profilePictureUrl: account.profile_picture_url || '',
        accountType: account.account_type || 'BUSINESS',
        accessToken: userToken,
        expiresAt: Date.now() + Number(expiresIn) * 1000,
        connectedAt: new Date().toISOString()
      }));
      await kv.del('instagram:last_error');
      await kv.set('instagram:profile', JSON.stringify({ ...PROFILE_DEFAULTS, handle: '@' + username, profileUrl: 'https://instagram.com/' + username, appUrl: PROFILE_DEFAULTS.profileUrl, updatedAt: new Date().toISOString() }));
      res.redirect(302, '/dashboard?instagram=connected#content');
      return;
    }

    if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

    if (req.method === 'GET' && action === 'status') {
      const [savedProfile, connected, lastError] = await Promise.all([profile(), connection(), kv.get('instagram:last_error')]);
      res.status(200).json({ configured: Boolean(APP_ID && APP_SECRET), connected: Boolean(connected?.igUserId && connected?.accessToken), username: connected?.username || '', profilePictureUrl: connected?.profilePictureUrl || '', profile: savedProfile, lastError: lastError || '' });
      return;
    }

    if (req.method === 'GET' && action === 'connect') {
      if (!APP_ID || !APP_SECRET) {
        res.redirect(302, '/dashboard?instagram=meta_setup_required#content');
        return;
      }
      const state = crypto.randomBytes(24).toString('hex');
      await kv.set('instagram:oauth:' + state, '1', { ex: 600 });
      const scopes = process.env.META_INSTAGRAM_SCOPES || 'instagram_business_basic,instagram_business_content_publish';
      const params = new URLSearchParams({ client_id: APP_ID, redirect_uri: redirectUri(req), state, scope: scopes, response_type: 'code', enable_fb_login: '0', force_authentication: '1' });
      res.redirect(302, 'https://www.instagram.com/oauth/authorize?' + params.toString());
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (action === 'save-profile') {
      const saved = { displayName: clean(req.body.displayName, 120), handle: clean(req.body.handle, 100), bio: clean(req.body.bio, 300), profileUrl: clean(req.body.profileUrl, 300), updatedAt: new Date().toISOString() };
      if (saved.profileUrl && !/^https:\/\//i.test(saved.profileUrl)) { res.status(400).json({ error: 'Enter a valid https:// link' }); return; }
      await kv.set('instagram:profile', JSON.stringify(saved));
      res.status(200).json({ ok: true, profile: saved });
      return;
    }

    if (action === 'disconnect') {
      await kv.del('instagram:connection');
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'publish') {
      if (req.body.confirm !== true) { res.status(400).json({ error: 'Publishing requires explicit confirmation' }); return; }
      const connected = await connection();
      if (!connected?.igUserId || !connected?.accessToken) { res.status(400).json({ error: 'Connect an Instagram professional account first' }); return; }
      const mediaType = clean(req.body.mediaType, 20) === 'video' ? 'video' : 'image';
      const mediaUrl = clean(req.body.mediaUrl, 1200);
      const caption = clean(req.body.caption, 2200);
      if (!sameHost(req, mediaUrl)) { res.status(400).json({ error: 'Only media generated by this Ascend app can be published' }); return; }
      let creationId = clean(req.body.creationId, 160);
      if (!creationId) {
        const params = new URLSearchParams({ caption, access_token: connected.accessToken });
        if (mediaType === 'video') { params.set('media_type', 'REELS'); params.set('video_url', mediaUrl); params.set('share_to_feed', 'true'); }
        else params.set('image_url', mediaUrl);
        const created = await graph('/' + connected.igUserId + '/media', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
        creationId = created.id;
      }
      const status = await graph('/' + creationId + '?fields=status_code,status&access_token=' + encodeURIComponent(connected.accessToken));
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error(status.status || 'Instagram could not process the media');
      if (status.status_code !== 'FINISHED') { res.status(202).json({ processing: true, creationId, status: status.status_code || 'IN_PROGRESS' }); return; }
      const published = await graph('/' + connected.igUserId + '/media_publish', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: creationId, access_token: connected.accessToken }) });
      res.status(200).json({ published: true, mediaId: published.id });
      return;
    }

    res.status(400).json({ error: 'Unknown Instagram action' });
  } catch (error) {
    console.error('Instagram integration error:', error.message);
    if (req.method === 'GET' && clean(req.query?.action, 40) === 'callback') {
      await kv.set('instagram:last_error', clean(error.message, 500), { ex: 3600 });
      res.redirect(302, '/dashboard?instagram=connection_failed#content');
      return;
    }
    res.status(500).json({ error: error.message || 'Instagram request failed' });
  }
}
