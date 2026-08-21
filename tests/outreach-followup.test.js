import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseFollowupCandidates, followupMessage } from '../lib/outreach-followup.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.parse('2026-08-21T18:00:00.000Z');

function lead(id, overrides = {}) {
  return {
    id, to: `${id}@example.com`, contactName: `Business ${id}`, industry: 'car_wash',
    sequence: 1, timestamp: now - DAY, opened: true, firstOpenedAt: now - 8 * HOUR,
    lastOpenedAt: now - 7 * HOUR, openCount: 2, knownAutomatedOpenCount: 0,
    ...overrides,
  };
}

test('prioritizes confirmed visitors, then likely-human openers', () => {
  const opened = lead('opened');
  const visited = lead('visited', { confirmedVisit: true, firstConfirmedAt: now - 6 * HOUR });
  const candidates = chooseFollowupCandidates([opened, visited], new Set(), now);
  assert.deepEqual(candidates.map(item => [item.entry.id, item.sequence, item.intent]), [
    ['visited', 2, 'confirmed_visit'], ['opened', 2, 'human_open'],
  ]);
});

test('does not follow up with automated opens, replies, failures, or unsubscribes', () => {
  const bot = lead('bot');
  const entries = [bot, lead('reply', { replied: true }), lead('bounce', { status: 'bounced' }), lead('optout', { unsubscribed: true })];
  assert.deepEqual(chooseFollowupCandidates(entries, new Set(['bot']), now), []);
});

test('sends one final note after the first follow-up and then stops', () => {
  const original = lead('original', { confirmedVisit: true, firstConfirmedAt: now - 5 * DAY });
  const second = { id: 'second', to: original.to, followUpOf: original.id, sequence: 2, timestamp: now - 3 * DAY };
  assert.equal(chooseFollowupCandidates([original, second], new Set(), now)[0].sequence, 3);
  const third = { id: 'third', to: original.to, followUpOf: original.id, sequence: 3, timestamp: now - DAY };
  assert.deepEqual(chooseFollowupCandidates([original, second, third], new Set(), now), []);
});

test('follow-up copy explains Nitro without reviving the removed personal offer', () => {
  for (const sequence of [2, 3]) {
    const message = followupMessage(lead('copy'), sequence);
    assert.match(message.body, /website building, social content and scheduling, tracked outreach, and visitor analytics/);
    assert.match(message.body, /nitrooutreach\.com/);
    assert.doesNotMatch(message.body, /personally build|hands-on|I[’']m offering|build it/i);
  }
  assert.match(followupMessage(lead('copy'), 3).body, /last follow-up/i);
});
