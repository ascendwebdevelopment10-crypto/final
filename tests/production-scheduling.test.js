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
  assert.match(workspace, /mediaType === 'reel'/);
  assert.match(workspace, /parsed\.protocol !== 'https:'/);
  assert.match(worker, /post\.status = 'publishing'/);
  assert.match(worker, /publishReel/);
  assert.match(worker, /post\.status = 'published'/);
  assert.match(worker, /post\.status = 'failed'/);
});

test('social scheduler exposes a visible calendar and full queue controls', async () => {
  const client = await readFile(new URL('../public/customer/app.js', import.meta.url), 'utf8');
  assert.match(client, /function socialCalendar/);
  assert.match(client, /PUBLISHING CALENDAR/);
  assert.match(client, /data-edit-social/);
  assert.match(client, /data-cancel-social/);
  assert.match(client, /Reel \(public MP4\)/);
});

test('social connections are only publicized as connected when tokens are usable', async () => {
  const source = await readFile(new URL('../lib/customer-auth.js', import.meta.url), 'utf8');
  assert.match(source, /connectionStatus: healthy \? 'connected' : expired \? 'expired' : 'broken'/);
  assert.match(source, /Boolean\(token && publicMeta\.igUserId && !expired\)/);
  assert.match(source, /Boolean\(publicConnection\.connected && platformReady && !expired\)/);
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

test('Nitro campaign schedules six daily posts with deployable media', async () => {
  assert.equal(NITRO_SOCIAL_CAMPAIGN.length, 6);
  assert.deepEqual(
    NITRO_SOCIAL_CAMPAIGN.map(post => post.scheduledFor),
    [13, 14, 15, 16, 17, 18].map(day => `2026-08-${day}T17:30:00.000Z`),
  );
  for (const post of NITRO_SOCIAL_CAMPAIGN) {
    assert.match(post.caption, /\S/);
    assert.match(post.imagePath, /^\/social\/aug-2026\/\d{2}-[a-z-]+\.jpg$/);
    await access(new URL(`../public${post.imagePath}`, import.meta.url));
  }
});
