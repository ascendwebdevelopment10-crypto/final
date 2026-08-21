import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { NITRO_SOCIAL_CAMPAIGN } from '../api/social-cron.js';

test('production runs the social publishing worker and not the disabled reply drainer', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const crons = config.crons || [];
  assert.ok(crons.some(job => job.path === '/api/social-cron'), 'social publishing must have a production schedule');
  assert.equal(crons.some(job => job.path === '/api/send-pending-replies'), false, 'disabled auto-reply queue must not run every minute');
});

test('scheduled Instagram posts and Reels require public HTTPS media', async () => {
  const [workspace, worker] = await Promise.all([
    readFile(new URL('../api/customer-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/social-cron.js', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /requestedMedia === 'reel' \|\| requestedMedia === 'video'/);
  assert.match(workspace, /parsed\.protocol !== 'https:'/);
  assert.match(worker, /post\.status = 'publishing'/);
  assert.match(worker, /publishReel/);
  assert.match(worker, /post\.status = 'published'/);
  assert.match(worker, /post\.status = 'failed'/);
});

test('Facebook, TikTok, LinkedIn, and YouTube have real publishing adapters', async () => {
  const [publishers, oauth, worker, workspace] = await Promise.all([
    readFile(new URL('../lib/social-publishers.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/social-oauth.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/social-cron.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/customer-workspace.js', import.meta.url), 'utf8'),
  ]);
  assert.match(publishers, /publishFacebook/);
  assert.match(publishers, /publishTikTok/);
  assert.match(publishers, /publishLinkedIn/);
  assert.match(publishers, /publishYouTube/);
  assert.match(publishers, /post\/publish\/status\/fetch/);
  assert.match(oauth, /user\.info\.basic,video\.publish/);
  assert.match(oauth, /refreshSocialConnection/);
  assert.match(worker, /publishToPlatform/);
  assert.match(worker, /tiktokPublishStatus/);
  assert.match(workspace, /requestedPlatform === 'all'/);
  assert.match(workspace, /data\.socialDrafts\.unshift\(\.\.\.drafts\)/);
});

test('multi-platform scheduler keeps per-platform jobs and honest media requirements', async () => {
  const [workspace, client] = await Promise.all([
    readFile(new URL('../api/customer-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer/app.js', import.meta.url), 'utf8'),
  ]);
  for (const platform of ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube']) {
    assert.match(workspace, new RegExp(`['"]${platform}['"]`));
    assert.match(client, new RegExp(`value:['"]${platform}['"]`));
  }
  assert.match(workspace, /YouTube scheduling requires a video/);
  assert.match(client, /All public-ready connected platforms/);
  assert.match(client, /id:`\$\{post\.id\}:\$\{platform\}`/);
  assert.match(client, /groupId:post\.id,platform/);
});

test('social scheduler exposes a visible calendar and full queue controls', async () => {
  const [client, socialV4, socialV8, view] = await Promise.all([
    readFile(new URL('../public/customer/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer/social-v4.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer/social-v8.css', import.meta.url), 'utf8'),
    readFile(new URL('../views/customer.html', import.meta.url), 'utf8'),
  ]);
  assert.match(client, /function socialCalendar/);
  assert.match(client, /Publishing calendar/);
  assert.match(client, /NEXT 7 DAYS/);
  assert.match(client, /including weekends/);
  assert.match(client, /groupSocialQueue/);
  assert.match(client, /data-edit-social/);
  assert.match(client, /data-cancel-social/);
  assert.match(client, /Video \/ Short \(works across all five\)/);
  assert.match(client, /social-calendar-legend/);
  assert.match(client, /calendar-platforms/);
  assert.doesNotMatch(socialV4, /while\(articles\.length<7\)/);
  assert.match(socialV4, /social-queue-visible-v8/);
  assert.match(socialV8, /grid-template-columns:repeat\(7/);
  assert.match(view, /social-v8\.css/);
});

test('confirmed-visitor follow-up runs hourly and shares the provider quota with cold outreach', async () => {
  const [cron, followup, email] = await Promise.all([
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../api/outreach-followup-cron.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/email-cron.js', import.meta.url), 'utf8'),
  ]);
  assert.match(cron, /outreach-followup-cron[^\n]+5 \* \* \* \*/);
  assert.match(followup, /PROVIDER_DAILY_CAP = 100/);
  assert.doesNotMatch(followup, /DAILY_CAP = 5/);
  assert.match(email, /outreach:email:all-daily-reserved/);
  assert.match(followup, /outreach:email:all-daily-reserved/);
});

test('cross-platform analytics groups one creative into honest per-platform results', async () => {
  const [analytics, client, css] = await Promise.all([
    readFile(new URL('../api/social-analytics.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer/app.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(analytics, /facebookMetrics/);
  assert.match(analytics, /Detailed post metrics are unavailable/);
  assert.match(analytics, /youtubeMetrics/);
  assert.match(analytics, /groupId/);
  assert.match(client, /data-social-analytics-platform/);
  assert.match(client, /One post\. Separate results by platform\./);
  assert.match(css, /\.social-performance-card/);
  assert.match(css, /\.social-platform-result/);
});

test('all-platform scheduling excludes unaudited public TikTok jobs', async () => {
  const workspace = await readFile(new URL('../api/customer-workspace.js', import.meta.url), 'utf8');
  assert.match(workspace, /publicPublishingApproved === true/);
  assert.match(workspace, /TikTok public auto-publishing is awaiting audit approval/);
  assert.match(workspace, /const publicReady = compatible\.filter/);
});

test('social connections are only publicized as connected when tokens are usable', async () => {
  const source = await readFile(new URL('../lib/customer-auth.js', import.meta.url), 'utf8');
  const oauth = await readFile(new URL('../lib/social-oauth.js', import.meta.url), 'utf8');
  assert.match(source, /connectionStatus: healthy \? 'connected' : expired \? 'expired' : 'broken'/);
  assert.match(source, /Boolean\(token && publicMeta\.igUserId && !expired\)/);
  assert.match(source, /Boolean\(publicConnection\.connected && platformReady && !expired\)/);
  assert.match(oauth, /SOCIAL_\$\{platform\.toUpperCase\(\)\}_ENABLED/);
  assert.match(oauth, /enabled && creds\.id && creds\.secret && stateSecret\(\)/);
});

test('Instagram analytics includes comparisons and post-level lead/signup attribution', async () => {
  const [insights, link, auth] = await Promise.all([
    readFile(new URL('../api/instagram-insights.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/social-link.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/customer-auth.js', import.meta.url), 'utf8'),
  ]);
  assert.match(insights, /engagementRate/);
  assert.match(insights, /performanceVsAverage/);
  assert.match(insights, /customer:social-leads/);
  assert.match(insights, /customer:social-signups/);
  assert.match(link, /nitro_social_attribution/);
  assert.match(auth, /customer:social-signups/);
});

test('Nitro campaign schedules the original and current acquisition posts with deployable media', async () => {
  assert.equal(NITRO_SOCIAL_CAMPAIGN.length, 9);
  assert.deepEqual(
    NITRO_SOCIAL_CAMPAIGN.map(post => post.scheduledFor),
    [13, 14, 15, 16, 17, 18].map(day => `2026-08-${day}T17:30:00.000Z`).concat([
      '2026-08-22T18:30:00.000Z', '2026-08-23T18:30:00.000Z', '2026-08-24T18:30:00.000Z',
    ]),
  );
  for (const post of NITRO_SOCIAL_CAMPAIGN) {
    assert.match(post.caption, /\S/);
    assert.match(post.imagePath, /^\/social\/aug-2026\/\d{2}-[a-z-]+\.jpg$/);
    await access(new URL(`../public${post.imagePath}`, import.meta.url));
  }
});
