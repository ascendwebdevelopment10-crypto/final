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

test('follows up with every confirmed visitor after 24 hours, oldest first', () => {
  const opened = lead('opened');
  const recentVisit = lead('recent', { confirmedVisit: true, firstConfirmedAt: now - 23 * HOUR });
  const dueVisit = lead('due', { confirmedVisit: true, firstConfirmedAt: now - 25 * HOUR });
  const olderVisit = lead('older', { confirmedVisit: true, firstConfirmedAt: now - 3 * DAY });
  const candidates = chooseFollowupCandidates([opened, recentVisit, dueVisit, olderVisit], new Set(), now);
  assert.deepEqual(candidates.map(item => [item.entry.id, item.sequence, item.intent]), [
    ['older', 2, 'confirmed_visit'], ['due', 2, 'confirmed_visit'],
  ]);
});

test('does not follow up with opens alone, replies, failures, unsubscribes, or duplicate follow-ups', () => {
  const confirmed = { confirmedVisit: true, firstConfirmedAt: now - 2 * DAY };
  const original = lead('done', confirmed);
  const entries = [lead('open-only'), lead('reply', { ...confirmed, replied: true }), lead('bounce', { ...confirmed, status: 'bounced' }), lead('optout', { ...confirmed, unsubscribed: true }), original, { id: 'followup', to: original.to, followUpOf: original.id, sequence: 2, timestamp: now - DAY }];
  assert.deepEqual(chooseFollowupCandidates(entries, new Set(), now), []);
});

test('keeps confirmed visits eligible for 30 days so an hourly run can catch every business', () => {
  assert.equal(chooseFollowupCandidates([lead('day30', { confirmedVisit: true, firstConfirmedAt: now - 30 * DAY })], new Set(), now).length, 1);
  assert.equal(chooseFollowupCandidates([lead('expired', { confirmedVisit: true, firstConfirmedAt: now - 31 * DAY })], new Set(), now).length, 0);
});

test('follow-up copy explains Nitro without reviving the removed personal offer', () => {
  const message = followupMessage(lead('copy'));
  assert.match(message.body, /website building, social content and scheduling, tracked outreach, and visitor analytics/);
  assert.match(message.body, /nitrooutreach\.com/);
  assert.doesNotMatch(message.body, /personally build|hands-on|I[’']m offering|build it|last follow-up/i);
});
