import assert from 'node:assert/strict';
import test from 'node:test';

import { completeSocialConnection } from '../lib/social-oauth.js';

test('TikTok accepts a successful profile response with error.code ok', async t => {
  const originalFetch = global.fetch;
  const responses = [
    {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 86400,
    },
    {
      data: { user: { open_id: 'user-id', display_name: 'Nitro Owner' } },
      error: { code: 'ok', message: '', log_id: 'test-log' },
    },
  ];

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responses.shift(),
  });
  t.after(() => { global.fetch = originalFetch; });

  const connection = await completeSocialConnection('tiktok', 'authorization-code');

  assert.equal(connection.connected, true);
  assert.equal(connection.accountId, 'user-id');
  assert.equal(connection.accountName, 'Nitro Owner');
  assert.equal(connection.accessToken, 'access-token');
});

test('TikTok still surfaces a real provider error object', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ error: { code: 'scope_not_authorized', message: 'Scope is not authorized.' } }),
  });
  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    completeSocialConnection('tiktok', 'authorization-code'),
    /Scope is not authorized\./,
  );
});
