import { refreshSocialConnection } from './social-oauth.js';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || '202607';
const MAX_REMOTE_MEDIA_BYTES = 128 * 1024 * 1024;

function clean(value, max = 4000) { return String(value || '').trim().slice(0, max); }

async function providerJson(url, init = {}) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  const providerError = data?.error?.message || data?.error_description || data?.message || data?.error?.code;
  if (!response.ok || (data?.error && data.error.code !== 'ok')) throw new Error(clean(providerError, 500) || `Social provider request failed (${response.status})`);
  return { response, data };
}

function safeMediaUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Add a valid public HTTPS media URL.'); }
  if (url.protocol !== 'https:') throw new Error('Media must use a public HTTPS URL.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host)) throw new Error('That media host is not public.');
  return url.toString();
}

function privateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (value.includes(':')) return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:');
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

async function validatePublicHost(value) {
  const url = new URL(safeMediaUrl(value));
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error('That media host does not resolve to a public address.');
  return url;
}

async function remoteMedia(url, expected = '') {
  let mediaUrl = await validatePublicHost(url);
  let response;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetch(mediaUrl, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) throw new Error('The media URL redirected too many times.');
    mediaUrl = await validatePublicHost(new URL(location, mediaUrl).toString());
  }
  if (!response.ok || !response.body) throw new Error(`Nitro could not download the scheduled media (${response.status}).`);
  const length = Number(response.headers.get('content-length') || 0);
  if (!length) throw new Error('The media server must provide a Content-Length header.');
  if (length > MAX_REMOTE_MEDIA_BYTES) throw new Error('Keep scheduled media under 128 MB.');
  const type = response.headers.get('content-type') || expected || 'application/octet-stream';
  return { response, length, type };
}

export async function usableConnection(platform, connection) {
  if (!connection?.connected) throw new Error(`Connect ${platform} before scheduling to it.`);
  const expiresAt = Date.parse(connection.tokenExpiresAt || 0);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 5 * 60 * 1000) return refreshSocialConnection(platform, connection);
  if (!connection.accessToken && platform !== 'facebook') throw new Error(`Reconnect ${platform}; its access token is unavailable.`);
  if (platform === 'facebook' && (!connection.pageId || !connection.pageAccessToken)) throw new Error('Reconnect Facebook and select a Page you manage.');
  return connection;
}

async function publishFacebook(connection, post) {
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
  const base = `https://graph.facebook.com/${version}/${encodeURIComponent(connection.pageId)}`;
  const token = connection.pageAccessToken;
  const mediaUrl = post.mediaUrl ? safeMediaUrl(post.mediaUrl) : '';
  let endpoint = '/feed';
  const params = { access_token: token };
  if (post.mediaType === 'image' && mediaUrl) { endpoint = '/photos'; params.url = mediaUrl; params.message = post.text; }
  else if (post.mediaType === 'video' && mediaUrl) { endpoint = '/videos'; params.file_url = mediaUrl; params.description = post.text; }
  else params.message = post.text;
  const { data } = await providerJson(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  return { state: 'published', id: data.post_id || data.id };
}

async function tiktokCreator(connection) {
  const { data } = await providerJson('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json; charset=UTF-8' }, body: '{}' });
  return data.data || {};
}

async function publishTikTok(connection, post) {
  const creator = await tiktokCreator(connection);
  const requested = clean(post.privacyLevel, 40) || 'PUBLIC_TO_EVERYONE';
  const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
  const privacy = options.includes(requested) ? requested : options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0];
  if (!privacy) throw new Error('TikTok did not return an available privacy setting for this account.');
  const postInfo = {
    title: clean(post.text, 150), privacy_level: privacy,
    disable_comment: Boolean(creator.comment_disabled),
    disable_duet: Boolean(creator.duet_disabled),
    disable_stitch: Boolean(creator.stitch_disabled),
  };
  if (post.mediaType === 'image') {
    const imageUrl = safeMediaUrl(post.mediaUrl);
    const verifiedHosts = new Set(String(process.env.TIKTOK_VERIFIED_MEDIA_HOSTS || 'nitrooutreach.com,www.nitrooutreach.com').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
    if (!verifiedHosts.has(new URL(imageUrl).hostname.toLowerCase())) throw new Error('TikTok photo publishing requires a URL hosted on a domain verified in the TikTok developer app.');
    const { data } = await providerJson('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ post_info: { ...postInfo, description: clean(post.text, 4000) }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [imageUrl] }, post_mode: 'DIRECT_POST', media_type: 'PHOTO' }),
    });
    return { state: 'publishing', id: data.data?.publish_id };
  }
  if (post.mediaType !== 'video') throw new Error('TikTok requires an image or video.');
  const media = await remoteMedia(post.mediaUrl, 'video/mp4');
  if (media.length > 64 * 1024 * 1024) throw new Error('Keep TikTok videos under 64 MB.');
  if (creator.max_video_post_duration_sec && Number(post.durationSeconds || 0) > Number(creator.max_video_post_duration_sec)) throw new Error(`This TikTok account allows videos up to ${creator.max_video_post_duration_sec} seconds.`);
  const { data } = await providerJson('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ post_info: postInfo, source_info: { source: 'FILE_UPLOAD', video_size: media.length, chunk_size: media.length, total_chunk_count: 1 } }),
  });
  const uploadUrl = data.data?.upload_url;
  if (!uploadUrl || !data.data?.publish_id) throw new Error('TikTok did not create an upload session.');
  const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': media.type, 'content-length': String(media.length), 'content-range': `bytes 0-${media.length - 1}/${media.length}` }, body: media.response.body, duplex: 'half' });
  if (!uploaded.ok) throw new Error(`TikTok media upload failed (${uploaded.status}).`);
  return { state: 'publishing', id: data.data.publish_id };
}

async function linkedinHeaders(connection, contentType = 'application/json') {
  return { Authorization: `Bearer ${connection.accessToken}`, 'content-type': contentType, 'LinkedIn-Version': LINKEDIN_VERSION, 'X-Restli-Protocol-Version': '2.0.0' };
}

async function linkedinImage(connection, mediaUrl) {
  const owner = `urn:li:person:${connection.accountId}`;
  const { data } = await providerJson('https://api.linkedin.com/rest/images?action=initializeUpload', { method: 'POST', headers: await linkedinHeaders(connection), body: JSON.stringify({ initializeUploadRequest: { owner } }) });
  const value = data.value || {};
  const media = await remoteMedia(mediaUrl, 'image/jpeg');
  const upload = await fetch(value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': media.type, 'content-length': String(media.length) }, body: media.response.body, duplex: 'half' });
  if (!upload.ok) throw new Error(`LinkedIn image upload failed (${upload.status}).`);
  return value.image;
}

async function linkedinVideo(connection, mediaUrl) {
  const owner = `urn:li:person:${connection.accountId}`;
  const media = await remoteMedia(mediaUrl, 'video/mp4');
  const bytes = Buffer.from(await media.response.arrayBuffer());
  const { data } = await providerJson('https://api.linkedin.com/rest/videos?action=initializeUpload', { method: 'POST', headers: await linkedinHeaders(connection), body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }) });
  const value = data.value || {}, partIds = [];
  for (const instruction of value.uploadInstructions || []) {
    const first = Number(instruction.firstByte || 0), last = Math.min(Number(instruction.lastByte), bytes.length - 1);
    const upload = await fetch(instruction.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes.subarray(first, last + 1) });
    if (!upload.ok) throw new Error(`LinkedIn video upload failed (${upload.status}).`);
    const etag = String(upload.headers.get('etag') || '').replace(/^"|"$/g, '');
    if (!etag) throw new Error('LinkedIn did not confirm an uploaded video part.');
    partIds.push(etag);
  }
  await providerJson('https://api.linkedin.com/rest/videos?action=finalizeUpload', { method: 'POST', headers: await linkedinHeaders(connection), body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken || '', uploadedPartIds: partIds } }) });
  return value.video;
}

async function publishLinkedIn(connection, post) {
  const body = {
    author: `urn:li:person:${connection.accountId}`, commentary: clean(post.text, 3000), visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  };
  if (post.mediaType === 'image' && post.mediaUrl) body.content = { media: { id: await linkedinImage(connection, post.mediaUrl), title: clean(post.title || post.text, 120) } };
  else if (post.mediaType === 'video' && post.mediaUrl) body.content = { media: { id: await linkedinVideo(connection, post.mediaUrl), title: clean(post.title || post.text, 120) } };
  const { response } = await providerJson('https://api.linkedin.com/rest/posts', { method: 'POST', headers: await linkedinHeaders(connection), body: JSON.stringify(body) });
  return { state: 'published', id: response.headers.get('x-restli-id') || '' };
}

async function publishYouTube(connection, post) {
  if (post.mediaType !== 'video' || !post.mediaUrl) throw new Error('YouTube requires a public video URL.');
  const media = await remoteMedia(post.mediaUrl, 'video/mp4');
  const privacy = clean(post.privacyLevel, 40) === 'SELF_ONLY' ? 'private' : 'public';
  const metadata = { snippet: { title: clean(post.title || post.text.split('\n')[0], 100) || 'Nitro scheduled video', description: clean(post.text, 5000), categoryId: '22' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json', 'x-upload-content-type': media.type, 'x-upload-content-length': String(media.length) }, body: JSON.stringify(metadata),
  });
  if (!start.ok) { const error = await start.json().catch(() => ({})); throw new Error(error?.error?.message || `YouTube upload could not start (${start.status}).`); }
  const location = start.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload session.');
  const { data } = await providerJson(location, { method: 'PUT', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': media.type, 'content-length': String(media.length) }, body: media.response.body, duplex: 'half' });
  return { state: 'published', id: data.id };
}

export async function publishToPlatform(platform, connection, post) {
  if (platform === 'facebook') return publishFacebook(connection, post);
  if (platform === 'tiktok') return publishTikTok(connection, post);
  if (platform === 'linkedin') return publishLinkedIn(connection, post);
  if (platform === 'youtube') return publishYouTube(connection, post);
  throw new Error(`Publishing to ${platform} is not supported.`);
}

export async function tiktokPublishStatus(connection, publishId) {
  const { data } = await providerJson('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
  const status = data.data?.status;
  if (status === 'PUBLISH_COMPLETE') return { state: 'published', id: data.data?.publicaly_available_post_id?.[0] || publishId };
  if (status === 'FAILED') return { state: 'failed', error: data.data?.fail_reason || 'TikTok could not publish this post.' };
  return { state: 'publishing' };
}
