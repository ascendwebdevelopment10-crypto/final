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

test('scheduled Instagram posts require public HTTPS media', async () => {
  const source = await readFile(new URL('../api/customer-workspace.js', import.meta.url), 'utf8');
  assert.match(source, /Instagram cannot publish a text-only post/);
  assert.match(source, /parsed\.protocol !== 'https:'/);
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
