import { kv } from '@vercel/kv';
import { publishImage, publishReel } from '../lib/meta.js';
import { notifyBestEffort } from '../lib/ntfy.js';
import { publishToPlatform, tiktokPublishStatus, usableConnection } from '../lib/social-publishers.js';
import { generatedCaptionNeedsReview } from '../lib/social-quality.js';

export const config = { maxDuration: 300 };
const CRON_SECRET = process.env.CRON_SECRET;

export const NITRO_SOCIAL_CAMPAIGN = [
  { id:'2026-08-one-workspace', scheduledFor:'2026-08-13T17:30:00.000Z', imagePath:'/social/aug-2026/01-one-workspace.jpg', caption:'Five tabs do not make a marketing system. Nitro brings your website, content, social, ads, and outreach into one workspace so the work can actually move.\n\nStart free: nitrooutreach.com\n\n#smallbusinessmarketing #marketingworkflow #nitrooutreach' },
  { id:'2026-08-website', scheduledFor:'2026-08-14T17:30:00.000Z', imagePath:'/social/aug-2026/02-website.jpg', caption:'Quick question: does your website create the next conversation—or just sit there?\n\nWith Nitro, the page, visitor signal, and follow-up live together. Build it. See who came. Keep the momentum.\n\n#businesswebsite #leadgeneration #smallbusiness' },
  { id:'2026-08-content', scheduledFor:'2026-08-15T17:30:00.000Z', imagePath:'/social/aug-2026/03-content.jpg', caption:'The content chain:\n\nOne useful idea → one sharp hook → one Reel → one post → one campaign.\n\nNitro helps you stretch the idea without flattening your voice.\n\n#contentstudio #reelsstrategy #contentmarketing' },
  { id:'2026-08-social', scheduledFor:'2026-08-16T17:30:00.000Z', imagePath:'/social/aug-2026/04-social.jpg', caption:'Your future self does not want to remember what needs posting on Thursday. Put the whole week somewhere visible, adjust it once, and let the queue do its job.\n\n#socialscheduler #contentcalendar #smallbusinessowner' },
  { id:'2026-08-outreach', scheduledFor:'2026-08-17T17:30:00.000Z', imagePath:'/social/aug-2026/05-outreach.jpg', caption:'Opened is curiosity. Clicked is intent. Replied is a conversation.\n\nNitro keeps those signals together so your next follow-up is based on what actually happened—not a guess.\n\n#outreach #salesfollowup #leadtracking' },
  { id:'2026-08-start-free', scheduledFor:'2026-08-18T17:30:00.000Z', imagePath:'/social/aug-2026/06-start-free.jpg', caption:'$0 to start. No card. No forced demo.\n\nTry Nitro on one real job today: build a page, make a post, or organize your outreach. Keep it only if it earns its place.\n\nnitrooutreach.com\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach' },
  { id:'2026-08-five-tabs', scheduledFor:'2026-08-22T18:30:00.000Z', imagePath:'/social/aug-2026/07-five-tabs.jpg', caption:'Your marketing should not live in five separate tabs.\n\nNitro keeps your website, content, social scheduling, outreach, and analytics in one workspace—so the work and the results stay connected.\n\nStart free: nitrooutreach.com\n\n#smallbusinessmarketing #marketingtools #nitrooutreach' },
  { id:'2026-08-visit-next', scheduledFor:'2026-08-23T18:30:00.000Z', imagePath:'/social/aug-2026/08-visit-next.jpg', caption:'A website visit is only the start.\n\nNitro connects the page, the visitor signal, and the follow-up so a small business can see what happened and know what to do next.\n\nSee how it works: nitrooutreach.com\n\n#leadgeneration #websiteanalytics #smallbusiness' },
  { id:'2026-08-start-real-job', scheduledFor:'2026-08-24T18:30:00.000Z', imagePath:'/social/aug-2026/09-start-real-job.jpg', caption:'Start with one real part of your marketing.\n\nBuild a page, create this week’s content, or organize outreach in one workspace. Nitro has a $0 plan, no card, and no sales call.\n\nStart free: nitrooutreach.com\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach' },
];

async function campaignOverrides(){let v=await kv.get('nitro:social:campaign:2026-08:overrides');if(typeof v==='string'){try{v=JSON.parse(v)}catch{v={}}}return v&&typeof v==='object'?v:{}}

async function runNitroCampaign(now = Date.now()) {
  let instagram = await kv.get('instagram:connection');
  if (typeof instagram === 'string') { try { instagram = JSON.parse(instagram); } catch { instagram = null; } }
  const ownerEmail = String(process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
  const ownerId = await kv.get(`customer:email:${ownerEmail}`);
  const owner = ownerId ? await loadCustomer(String(ownerId)) : null;
  const targets = [];
  if (instagram?.igUserId && instagram?.accessToken) targets.push({ platform: 'instagram', connection: instagram });
  for (const platform of ['facebook', 'linkedin', 'tiktok']) {
    const candidate = owner?.socialConnections?.[platform];
    if (!candidate?.connected || (platform === 'tiktok' && candidate.publicPublishingApproved !== true)) continue;
    try { targets.push({ platform, connection: await usableConnection(platform, candidate) }); }
    catch (error) { await notifyBestEffort({ title: `Nitro ${platform} connection needs attention`, message: error.message, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com/app#social' }); }
  }
  if (!targets.length) return { published: 0, errors: [], skipped: 'nitro-public-socials-not-connected' };
  let state = await kv.get('nitro:social:campaign:2026-08');
  if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = {}; } }
  state = state && typeof state === 'object' ? state : {};
  const overrides=await campaignOverrides();
  let published = 0;
  const errors = [];
  for (const base of NITRO_SOCIAL_CAMPAIGN) {
    const override=overrides[base.id]||{};if(override.cancelled)continue;
    const post={...base,...override};
    if (Date.parse(post.scheduledFor) > now) continue;
    const legacy = state[post.id] || {}, platforms = { ...(legacy.platforms || {}) };
    if (legacy.mediaId && !platforms.instagram) platforms.instagram = { status: legacy.status || 'published', mediaId: legacy.mediaId, publishedAt: legacy.publishedAt };
    for (const target of targets) {
      if (platforms[target.platform]?.mediaId) continue;
      const lockKey = `nitro:social:publish-lock:${post.id}:${target.platform}`;
      const locked = await kv.set(lockKey, '1', { nx: true, ex: 300 });
      if (!locked) continue;
      try {
        platforms[target.platform] = { status: 'publishing', publishingStartedAt: new Date().toISOString() };
        state[post.id] = { ...legacy, platforms };
        await kv.set('nitro:social:campaign:2026-08', state);
        const mediaUrl = `https://nitrooutreach.com${post.imagePath}`;
        const result = target.platform === 'instagram' ? { id: await publishImage(target.connection.igUserId, target.connection.accessToken, post.caption, mediaUrl) } : await publishToPlatform(target.platform, target.connection, { text: post.caption, mediaType: 'image', mediaUrl });
        platforms[target.platform] = { status: 'published', mediaId: result.id || '', publishedAt: new Date().toISOString() };
        state[post.id] = target.platform === 'instagram' ? { ...legacy, ...platforms.instagram, platforms } : { ...legacy, platforms };
        await kv.set('nitro:social:campaign:2026-08', state); published += 1;
      } catch (error) {
        platforms[target.platform] = { status: 'failed', error: error.message, failedAt: new Date().toISOString() };
        state[post.id] = { ...legacy, platforms }; await kv.set('nitro:social:campaign:2026-08', state);
        errors.push({ campaign: post.id, platform: target.platform, error: error.message }); await kv.del(lockKey);
        await notifyBestEffort({ title: `Nitro ${target.platform} post failed`, message: `${post.id}: ${error.message}`, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com/app#social' });
      }
    }
  }
  return { published, errors };
}
async function loadCustomer(id) { let u = await kv.get(`customer:user:${id}`); if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } } return u; }
export async function runSocialPublish() {
  const now = Date.now(); const nitro = await runNitroCampaign(now); let published = nitro.published || 0; const errors = [...(nitro.errors || [])];
  const keys = await kv.keys('customer:user:*');
  for (const key of keys) {
    const user = await loadCustomer(key.split(':').pop()); if (!user) continue; const posts = user.workspace?.socialDrafts || []; let changed = false;
    const pendingTikTok = posts.filter(p => p.platform === 'tiktok' && p.status === 'publishing' && p.externalPublishId);
    for (const post of pendingTikTok) { try { const refreshed = await usableConnection('tiktok', user.socialConnections?.tiktok); user.socialConnections.tiktok = refreshed; const result = await tiktokPublishStatus(refreshed, post.externalPublishId); if (result.state === 'published') { post.status = 'published'; post.mediaId = result.id; post.publishedAt = new Date().toISOString(); published += 1; } else if (result.state === 'failed') { post.status = 'failed'; post.error = result.error; post.failedAt = new Date().toISOString(); errors.push({ user: user.id, platform: 'tiktok', error: result.error }); } post.lastStatusCheckAt = new Date().toISOString(); changed = true; } catch (error) { post.lastStatusCheckAt = new Date().toISOString(); post.statusCheckError = error.message; changed = true; } }
    const stale = posts.filter(p => p.status === 'publishing' && !(p.platform === 'tiktok' && p.externalPublishId) && Date.parse(p.publishingStartedAt || 0) <= now - 15 * 60 * 1000);
    for (const post of stale) { post.status = 'failed'; post.error = `Publishing was interrupted before ${post.platform || 'the platform'} confirmed the result. Check the account before retrying to avoid a duplicate post.`; post.failedAt = new Date().toISOString(); }
    const unsafeGenerated = posts.filter(p => p.autoWeek === true && p.status === 'scheduled' && generatedCaptionNeedsReview(`${p.title || ''} ${p.text || ''}`));
    for (const post of unsafeGenerated) { post.status = 'failed'; post.error = 'Generated caption needs review before publishing.'; post.contentSafetyFailed = true; post.failedAt = new Date().toISOString(); changed = true; errors.push({ user: user.id, platform: post.platform || 'instagram', error: post.error }); }
    const due = posts.filter(p => p.status === 'scheduled' && p.scheduledFor && Date.parse(p.scheduledFor) <= now); if (!due.length && !stale.length && !changed) continue; changed = changed || stale.length > 0;
    for (const post of due) { try { const platform = String(post.platform || 'instagram').toLowerCase(); const mediaType = post.mediaType === 'reel' || post.mediaType === 'video' ? 'video' : post.mediaType === 'text' ? 'text' : 'image'; const mediaUrl = post.mediaUrl || post.imageUrl; post.status = 'publishing'; post.publishingStartedAt = new Date().toISOString(); post.error = null; await kv.set(key, user); if (platform === 'instagram') { if (!user.meta?.token || !user.meta?.igUserId) throw new Error('Reconnect Instagram before this post can publish.'); if (!mediaUrl) throw new Error('Instagram requires a public image or video URL.'); const mediaId = mediaType === 'video' ? await publishReel(user.meta.igUserId, user.meta.token, post.text, mediaUrl) : await publishImage(user.meta.igUserId, user.meta.token, post.text, mediaUrl); post.status = 'published'; post.publishedAt = new Date().toISOString(); post.mediaId = mediaId; published += 1; } else { user.socialConnections = { ...(user.socialConnections || {}) }; const connection = await usableConnection(platform, user.socialConnections[platform]); user.socialConnections[platform] = connection; const result = await publishToPlatform(platform, connection, { ...post, mediaType }); post.mediaId = result.id || ''; if (result.state === 'publishing') { post.status = 'publishing'; post.externalPublishId = result.id; } else { post.status = 'published'; post.publishedAt = new Date().toISOString(); published += 1; } } changed = true; } catch (e) { post.status = 'failed'; post.error = e.message; post.failedAt = new Date().toISOString(); changed = true; errors.push({ user: user.id, platform: post.platform || 'instagram', error: e.message }); if (/token|expired|reconnect|authorization/i.test(e.message) && post.platform !== 'instagram' && user.socialConnections?.[post.platform]) { user.socialConnections[post.platform].connected = false; user.socialConnections[post.platform].connectionStatus = 'expired'; } await notifyBestEffort({ title: 'Scheduled social post failed', message: `${user.email || user.id} · ${post.platform || 'instagram'}: ${e.message}`, priority: 'high', tags: 'warning,camera', click: 'https://nitrooutreach.com/app#social' }); } }
    if (changed) await kv.set(key, user);
  }
  return { published, errors, nitro };
}
export default async function handler(req, res) { const auth = req.headers['authorization']; if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; } try { const result = await runSocialPublish(); res.status(200).json({ ...result, timestamp: new Date().toISOString() }); } catch (e) { res.status(200).json({ published: 0, errors: [{ fatal: e.message }] }); } }
