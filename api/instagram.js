import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { isAuthorized } from '../lib/auth.js';

export const config = { maxDuration: 60 };

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = 'https://graph.facebook.com/' + GRAPH_VERSION;
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
  return process.env.META_REDIRECT_URI || (origin(req) + '/api/instagram?action=callback');
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
      const params = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: redirectUri(req), code });
      const tokenData = await graph('/oauth/access_token?' + params.toString());
      let userToken = tokenData.access_token;
      try {
        const longParams = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: userToken });
        const longData = await graph('/oauth/access_token?' + longParams.toString());
        userToken = longData.access_token || userToken;
      } catch {}
      const pages = await graph('/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=' + encodeURIComponent(userToken));
      const page = (pages.data || []).find((x) => x.instagram_business_account);
      if (!page) throw new Error('No Instagram professional account connected to an accessible Facebook Page was found.');
      const username = page.instagram_business_account.username || 'ascendoutreachsystem';
      await kv.set('instagram:connection', JSON.stringify({ igUserId: page.instagram_business_account.id, username, profilePictureUrl: page.instagram_business_account.profile_picture_url || '', pageId: page.id, pageName: page.name, accessToken: page.access_token, connectedAt: new Date().toISOString() }));
      await kv.set('instagram:profile', JSON.stringify({ ...PROFILE_DEFAULTS, handle: '@' + username, profileUrl: 'https://instagram.com/' + username, appUrl: PROFILE_DEFAULTS.profileUrl, updatedAt: new Date().toISOString() }));
      res.redirect(302, '/dashboard#content');
      return;
    }

    if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

    if (req.method === 'GET' && action === 'status') {
      const [savedProfile, connected] = await Promise.all([profile(), connection()]);
      res.status(200).json({ configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), connected: Boolean(connected?.igUserId && connected?.accessToken), username: connected?.username || '', profilePictureUrl: connected?.profilePictureUrl || '', profile: savedProfile });
      return;
    }

    if (req.method === 'GET' && action === 'connect') {
      if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
        res.redirect(302, '/dashboard?instagram=meta_setup_required#content');
        return;
      }
      const state = crypto.randomBytes(24).toString('hex');
      await kv.set('instagram:oauth:' + state, '1', { ex: 600 });
      const scopes = process.env.META_INSTAGRAM_SCOPES || 'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish';
      const params = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: redirectUri(req), state, scope: scopes, response_type: 'code' });
      res.redirect(302, 'https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth?' + params.toString());
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (action === 'save-profile') {
      const saved = { displayName: clean(req.body.displayName, 120), handle: clean(req.body.handle, 100), bio: clean(req.body.bio, 300), profileUrl: clean(req.body.profileUrl, 300), updatedAt: new Date().toISOString() };
      if (saved.profileUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(saved.profileUrl)) { res.status(400).json({ error: 'Enter a valid instagram.com profile link' }); return; }
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
    if (req.method === 'GET' && clean(req.query?.action, 40) === 'callback') { res.redirect(302, '/dashboard#content'); return; }
    res.status(500).json({ error: error.message || 'Instagram request failed' });
  }
}
