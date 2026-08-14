import assert from 'node:assert/strict';
import test from 'node:test';
import { automatedOpenIds, likelyHumanOpen } from '../lib/outreach-analytics.js';
import { resolvedDeliveryStatus } from '../api/owner-data.js';

const base = Date.parse('2026-08-12T16:00:00.000Z');
function email(id, sentSeconds, openedSeconds, overrides = {}) {
  return {
    id,
    timestamp: base + sentSeconds * 1000,
    firstOpenedAt: base + openedSeconds * 1000,
    lastOpenedAt: base + openedSeconds * 1000,
    openCount: 1,
    opened: true,
    ...overrides,
  };
}

test('filters an immediate tracking-pixel load as likely automation', () => {
  const entry = email('a', 0, 12);
  const automated = automatedOpenIds([entry]);
  assert.equal(automated.has('a'), true);
  assert.equal(likelyHumanOpen(entry, automated), false);
});

test('filters a coordinated delayed open burst across recipients', () => {
  const entries = [0, 12, 25, 42].map((seconds, index) => email(String(index), -600, seconds));
  const automated = automatedOpenIds(entries);
  assert.equal(automated.size, 4);
});

test('keeps an ordinary delayed open and human-confirmed engagement', () => {
  const delayed = email('delayed', 0, 420);
  const engaged = email('engaged', 0, 8, { confirmedVisit: true });
  const automated = automatedOpenIds([delayed, engaged]);
  assert.equal(likelyHumanOpen(delayed, automated), true);
  assert.equal(likelyHumanOpen(engaged, automated), true);
});

test('filters requests already identified as automated at ingestion', () => {
  const entry = email('known', 0, 420, { knownAutomatedOpenCount: 1 });
  assert.equal(automatedOpenIds([entry]).has('known'), true);
});

test('recovers a message when a scanner opens first and a later browser opens separately', () => {
  const entry = email('scanner-then-human', 0, 8, {
    openCount: 2,
    knownAutomatedOpenCount: 1,
    lastOpenedAt: base + 8 * 60 * 1000,
  });
  const automated = automatedOpenIds([entry]);
  assert.equal(automated.has(entry.id), false);
  assert.equal(likelyHumanOpen(entry, automated), true);
});

test('does not recover repeated scanner-only requests', () => {
  const entry = email('scanner-only', 0, 8, {
    openCount: 2,
    knownAutomatedOpenCount: 2,
    lastOpenedAt: base + 8 * 60 * 1000,
  });
  const automated = automatedOpenIds([entry]);
  assert.equal(automated.has(entry.id), true);
  assert.equal(likelyHumanOpen(entry, automated), false);
});

test('does not turn an open or link load into a provider delivery event', () => {
  assert.equal(resolvedDeliveryStatus({ providerStatus: 'sent', webhookStatus: 'sent', openCount: 3, visitCount: 1 }), 'sent');
  assert.equal(resolvedDeliveryStatus({ providerStatus: 'delivered', webhookStatus: 'sent' }), 'delivered');
  assert.equal(resolvedDeliveryStatus({ providerStatus: 'sent', webhookStatus: 'sent', replied: true }), 'replied');
});
