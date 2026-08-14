import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { planFor } from '../lib/customer-plans.js';

const POSTS = [
  { title: 'One workspace, less chaos', text: 'Five disconnected tools create five places for work to get lost. Nitro keeps your website, content, social, ads, and outreach in one workspace so the next move is always obvious.\n\nStart free: nitrooutreach.com\n\n#smallbusinessmarketing #marketingworkflow #nitrooutreach', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/01-one-workspace.jpg' },
  { title: 'Your website should start conversations', text: 'A website should do more than exist. Build the page, see the visitor signal, and keep the follow-up moving from the same place.\n\nBuild yours with Nitro: nitrooutreach.com\n\n#businesswebsite #leadgeneration #smallbusiness', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/02-website.jpg' },
  { title: 'Turn one idea into a week of content', text: 'One useful idea can become the hook, the post, the Reel, and the campaign. Nitro helps you keep the idea consistent without making every post feel copied.\n\n#contentmarketing #reelsstrategy #smallbusinesscontent', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/03-content.jpg' },
  { title: 'Schedule it once', text: 'Your future self should not have to remember what needs posting tomorrow. Plan the week once, see it on the calendar, and let the queue handle the timing.\n\n#socialscheduler #contentcalendar #smallbusinessowner', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/04-social.jpg' },
  { title: 'Follow the signal', text: 'Opened is curiosity. Clicked is intent. Replied is a conversation. Keep those signals together so the next follow-up is based on what actually happened.\n\n#outreach #salesfollowup #leadtracking', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/05-outreach.jpg' },
  { title: 'Try one real job for free', text: '$0 to start. No card. No forced demo. Use Nitro for one real job today: build a page, make content, schedule posts, or organize outreach.\n\nnitrooutreach.com\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach', mediaUrl: 'https://nitrooutreach.com/social/aug-2026/06-start-free.jpg' },
  { title: 'Marketing should feel connected', text: 'The best marketing system is the one you can actually keep using. One place for the work, one view of what happened, and one clear next action. That is the point of Nitro.\n\nStart free: nitrooutreach.com\n\n#marketingtools #businessgrowth #nitrooutreach', mediaUrl: 'https://nitrooutreach.com/icons/icon-512.png' },
];

function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }
function cleanDate(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) && ts > Date.now() - 60_000 ? new Date(ts).toISOString() : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['POST', 'DELETE'].includes(req.method)) { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }

  user.workspace = user.workspace || {};
  user.workspace.socialDrafts = Array.isArray(user.workspace.socialDrafts) ? user.workspace.socialDrafts : [];

  if (req.method === 'DELETE') {
    const now = Date.now();
    const requestedBatch = String(req.body?.batchId || '').trim();
    const candidates = user.workspace.socialDrafts.filter(item => item?.autoWeek === true && item?.status === 'scheduled' && Date.parse(item?.scheduledFor || 0) > now);
    let batchId = requestedBatch;
    if (!batchId && candidates.length) {
      const latest = [...candidates].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
      batchId = latest?.batchId || '';
    }
    if (!batchId) { res.status(200).json({ ok: true, removed: 0, message: 'No generated week to undo.' }); return; }
    const before = user.workspace.socialDrafts.length;
    user.workspace.socialDrafts = user.workspace.socialDrafts.filter(item => !(item?.autoWeek === true && item?.batchId === batchId && item?.status === 'scheduled' && Date.parse(item?.scheduledFor || 0) > now));
    const removed = before - user.workspace.socialDrafts.length;
    if (removed) await saveCustomer(user);
    res.status(200).json({ ok: true, removed, batchId });
    return;
  }

  const plan = planFor(user.subscription?.plan);
  if (plan.id === 'free') { res.status(403).json({ error: 'Social scheduling starts on the Starter plan.' }); return; }

  const schedule = Array.isArray(req.body?.schedule) ? req.body.schedule.map(cleanDate).filter(Boolean).slice(0, 7) : [];
  if (schedule.length !== 7) { res.status(400).json({ error: 'Nitro needs seven valid schedule times.' }); return; }

  const connected = [];
  if (user.meta?.token && user.meta?.igUserId) connected.push('instagram');
  for (const platform of ['facebook', 'linkedin', 'tiktok']) {
    const c = user.socialConnections?.[platform];
    if (!c?.connected) continue;
    if (platform === 'tiktok' && c.publicPublishingApproved !== true) continue;
    connected.push(platform);
  }
  if (!connected.length) { res.status(400).json({ error: 'Connect at least one public-ready social account first.' }); return; }

  const now = Date.now();
  user.workspace.socialDrafts = user.workspace.socialDrafts.filter(item => !(item.autoWeek === true && item.status === 'scheduled' && Date.parse(item.scheduledFor || 0) > now));

  const batchId = id('auto_week');
  const drafts = [];
  POSTS.forEach((post, index) => {
    const groupId = id(`week_${index + 1}`);
    for (const platform of connected) {
      drafts.push({
        id: id('social'), groupId, batchId, autoWeek: true,
        title: post.title, text: post.text, platform,
        mediaType: 'image', mediaUrl: post.mediaUrl, imageUrl: post.mediaUrl,
        scheduledFor: schedule[index], status: 'scheduled', privacyLevel: 'PUBLIC_TO_EVERYONE',
        createdAt: new Date().toISOString(),
      });
    }
  });
  user.workspace.socialDrafts.unshift(...drafts);
  await saveCustomer(user);
  res.status(201).json({ ok: true, batchId, days: 7, platformCount: connected.length, platforms: connected, jobs: drafts.length });
}
