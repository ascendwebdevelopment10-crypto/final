import { kv } from '@vercel/kv';
import { currentCustomer } from '../lib/customer-auth.js';
import { getPublishedInstagramMedia } from '../lib/meta.js';
import { NITRO_SOCIAL_CAMPAIGN } from './social-cron.js';

export const config = { maxDuration: 60 };

const PLATFORMS = new Set(['all', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube']);

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function sumKnown(rows, key) { const values = rows.map(row => row[key]).filter(Number.isFinite); return values.length ? values.reduce((total, value) => total + value, 0) : null; }
function interactions(row) { return ['likes', 'comments', 'shares', 'saves'].map(key => number(row[key])).filter(Number.isFinite).reduce((total, value) => total + value, 0); }

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || `The platform returned ${response.status}.`);
  return data;
}

async function instagramMediaPreview(mediaId, token) {
  if (!mediaId || !token) return { mediaUrl: '', thumbnailUrl: '' };
  try {
    const data = await json(`https://graph.instagram.com/${encodeURIComponent(mediaId)}?fields=media_url,thumbnail_url&access_token=${encodeURIComponent(token)}`);
    return { mediaUrl: clean(data.media_url, 2000), thumbnailUrl: clean(data.thumbnail_url, 2000) };
  } catch {
    return { mediaUrl: '', thumbnailUrl: '' };
  }
}

async function attribution(userId, mediaId) {
  if (!mediaId) return { clicks: 0, leads: 0, signups: 0 };
  const [clicks, leads, signups] = await Promise.all([
    kv.get(`customer:social-clicks:${userId}:${mediaId}`),
    kv.get(`customer:social-leads:${userId}:${mediaId}`),
    kv.get(`customer:social-signups:${userId}:${mediaId}`),
  ]);
  return { clicks: Number(clicks || 0), leads: Number(leads || 0), signups: Number(signups || 0) };
}

async function facebookMetrics(connection, job) {
  if (!connection?.pageAccessToken || !job.mediaId) return { analyticsNote: 'Facebook has not confirmed a reportable post ID yet.' };
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
  const fields = 'id,created_time,permalink_url,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)';
  try {
    const data = await json(`https://graph.facebook.com/${version}/${encodeURIComponent(job.mediaId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(connection.pageAccessToken)}`);
    const result = {
      permalink: data.permalink_url || '', publishedAt: data.created_time || job.publishedAt,
      likes: number(data.reactions?.summary?.total_count),
      comments: number(data.comments?.summary?.total_count), shares: number(data.shares?.count), saves: null,
    };
    try {
      const insightData = await json(`https://graph.facebook.com/${version}/${encodeURIComponent(job.mediaId)}/insights?metric=post_impressions,post_impressions_unique,post_clicks&access_token=${encodeURIComponent(connection.pageAccessToken)}`);
      const insight = Object.fromEntries((insightData.data || []).map(item => [item.name, number(item.values?.[0]?.value)]));
      Object.assign(result, { views: insight.post_impressions, reach: insight.post_impressions_unique, clicks: insight.post_clicks });
    } catch (error) { result.analyticsNote = `Facebook published this post, but reach, views, and clicks need additional Page insights access: ${error.message}`; }
    return result;
  } catch (error) {
    return { analyticsNote: `Facebook published this post, but its insights are not available to the current Page permission: ${error.message}` };
  }
}

async function youtubeMetrics(connection, job) {
  if (!connection?.accessToken || !job.mediaId) return { analyticsNote: 'YouTube has not confirmed a reportable video ID yet.' };
  try {
    const data = await json(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(job.mediaId)}`, { headers: { Authorization: `Bearer ${connection.accessToken}` } });
    const video = data.items?.[0], stats = video?.statistics || {};
    if (!video) return { analyticsNote: 'YouTube did not return this video to the connected channel.' };
    return { permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(job.mediaId)}`, publishedAt: video.snippet?.publishedAt || job.publishedAt, thumbnailUrl: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || '', views: number(stats.viewCount), reach: null, likes: number(stats.likeCount), comments: number(stats.commentCount), shares: null, saves: null };
  } catch (error) { return { analyticsNote: `YouTube analytics are temporarily unavailable: ${error.message}` }; }
}

function baseVariant(job) {
  return {
    platform: clean(job.platform, 30) || 'instagram', status: clean(job.status, 30) || 'published',
    mediaId: clean(job.mediaId, 200), publishedAt: job.publishedAt || '', permalink: '',
    mediaUrl: clean(job.mediaUrl || job.imageUrl, 2000), thumbnailUrl: clean(job.thumbnailUrl, 2000), mediaType: clean(job.mediaType, 30),
    views: null, reach: null, likes: null, comments: null, shares: null, saves: null,
    clicks: 0, leads: 0, signups: 0,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  const platform = PLATFORMS.has(clean(req.query?.platform, 30).toLowerCase()) ? clean(req.query?.platform, 30).toLowerCase() : 'all';
  const cacheKey = `customer:social-analytics:${user.id}:${platform}`;
  if (req.query?.refresh !== '1') {
    let cached = await kv.get(cacheKey);
    if (typeof cached === 'string') { try { cached = JSON.parse(cached); } catch { cached = null; } }
    if (cached) { res.status(200).json({ ...cached, cached: true }); return; }
  }

  try {
    const groups = new Map();
    const add = (key, post, variant) => {
      const group = groups.get(key) || { id: key, groupId: post.groupId || key, title: post.title || '', text: post.text || '', mediaType: post.mediaType || 'image', mediaUrl: post.mediaUrl || post.imageUrl || variant.mediaUrl || '', thumbnailUrl: post.thumbnailUrl || variant.thumbnailUrl || '', scheduledFor: post.scheduledFor || '', publishedAt: post.publishedAt || '', platforms: [] };
      if (!group.text && post.text) group.text = post.text;
      if (!group.title && post.title) group.title = post.title;
      if (!group.mediaUrl && (post.mediaUrl || post.imageUrl || variant.mediaUrl)) group.mediaUrl = post.mediaUrl || post.imageUrl || variant.mediaUrl;
      if (!group.thumbnailUrl && (post.thumbnailUrl || variant.thumbnailUrl)) group.thumbnailUrl = post.thumbnailUrl || variant.thumbnailUrl;
      group.platforms.push(variant); groups.set(key, group);
    };

    const systemJobs = [];
    if (String(user.email || '').toLowerCase() === String(process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase()) {
      let campaignState = await kv.get('nitro:social:campaign:2026-08') || {};
      if (typeof campaignState === 'string') { try { campaignState = JSON.parse(campaignState); } catch { campaignState = {}; } }
      for (const post of NITRO_SOCIAL_CAMPAIGN) {
        const legacy = campaignState[post.id] || {}, savedPlatforms = { ...(legacy.platforms || {}) };
        if (legacy.mediaId && !savedPlatforms.instagram) savedPlatforms.instagram = legacy;
        for (const [jobPlatform, saved] of Object.entries(savedPlatforms)) systemJobs.push({ id: `${post.id}:${jobPlatform}`, groupId: post.id, text: post.caption, title: 'Nitro campaign post', mediaType: 'image', mediaUrl: `https://nitrooutreach.com${post.imagePath}`, scheduledFor: post.scheduledFor, platform: jobPlatform, ...saved });
      }
    }
    const allJobs = [...(user.workspace?.socialDrafts || []), ...systemJobs];
    const jobs = allJobs.filter(job => ['published', 'publishing', 'failed'].includes(job.status) && (platform === 'all' || job.platform === platform));
    for (const job of jobs) {
      const variant = baseVariant(job), connection = user.socialConnections?.[job.platform];
      Object.assign(variant, await attribution(user.id, job.mediaId));
      if (job.platform === 'facebook' && job.status === 'published') Object.assign(variant, await facebookMetrics(connection, job));
      if (job.platform === 'youtube' && job.status === 'published') Object.assign(variant, await youtubeMetrics(connection, job));
      if (job.platform === 'tiktok' && job.status === 'published') variant.analyticsNote = 'TikTok publishing is confirmed. Public performance metrics require the separate video.list approval.';
      if (job.platform === 'linkedin' && job.status === 'published') variant.analyticsNote = 'LinkedIn publishing is confirmed. Member-post analytics require additional LinkedIn approval.';
      add(job.groupId || job.id, job, variant);
    }

    if ((platform === 'all' || platform === 'instagram') && user.meta?.igUserId && user.meta?.token) {
      const instagram = await getPublishedInstagramMedia(user.meta.igUserId, user.meta.token, 25);
      for (const post of instagram) {
        const linkedJob = allJobs.find(job => job.platform === 'instagram' && job.mediaId === post.id);
        const tracked = await attribution(user.id, post.id);
        const preview = await instagramMediaPreview(post.id, user.meta.token);
        const variant = {
          platform: 'instagram', status: 'published', mediaId: post.id, publishedAt: post.timestamp || linkedJob?.publishedAt || '', permalink: post.permalink || '',
          mediaUrl: linkedJob?.mediaUrl || linkedJob?.imageUrl || preview.mediaUrl || '', thumbnailUrl: preview.thumbnailUrl || '', mediaType: linkedJob?.mediaType || (post.productType === 'REELS' || post.mediaType === 'VIDEO' ? 'video' : post.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : 'image'),
          views: number(post.views), reach: number(post.reach), likes: number(post.likes), comments: number(post.comments), shares: number(post.shares), saves: number(post.saved), ...tracked,
          analyticsNote: post.insightsError ? 'Instagram did not return every metric for this post.' : '',
        };
        add(linkedJob?.groupId || `instagram:${post.id}`, linkedJob || { id: post.id, text: post.caption || '', mediaType: variant.mediaType, mediaUrl: preview.mediaUrl, thumbnailUrl: preview.thumbnailUrl, publishedAt: post.timestamp }, variant);
      }
    }

    const posts = [...groups.values()].sort((a, b) => Date.parse(b.publishedAt || b.scheduledFor || 0) - Date.parse(a.publishedAt || a.scheduledFor || 0));
    const variants = posts.flatMap(post => post.platforms);
    const engagementValues = variants.map(item => ['likes', 'comments', 'shares', 'saves'].some(key => Number.isFinite(item[key])) ? interactions(item) : null).filter(Number.isFinite);
    const totals = {
      published: variants.filter(item => item.status === 'published').length,
      views: sumKnown(variants, 'views'), reach: sumKnown(variants, 'reach'),
      engagement: engagementValues.length ? engagementValues.reduce((total, value) => total + value, 0) : null,
      clicks: sumKnown(variants, 'clicks'), leads: sumKnown(variants, 'leads'), signups: sumKnown(variants, 'signups'),
    };
    const payload = { platform, syncedAt: new Date().toISOString(), totals, posts };
    await kv.set(cacheKey, payload, { ex: 120 });
    res.status(200).json(payload);
  } catch (error) { res.status(502).json({ error: error.message || 'Social analytics could not be loaded.' }); }
}
