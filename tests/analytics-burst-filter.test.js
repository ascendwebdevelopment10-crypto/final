import assert from 'node:assert/strict';
import test from 'node:test';
import { automatedOutreachBurstIdentities, isKnownAutomatedTraffic } from '../lib/analytics-traffic.js';

function visit(visitorId, seconds, overrides = {}) {
  return {
    id: `view-${visitorId}-${seconds}`,
    visitorId,
    viewedAt: new Date(Date.parse('2026-08-11T22:02:00.000Z') + seconds * 1000).toISOString(),
    city: 'San Jose',
    region: 'CA',
    country: 'US',
    device: 'Chrome · Windows',
    outreachId: `email-${visitorId}`,
    ...overrides,
  };
}

test('filters a coordinated outreach scanner burst', () => {
  const visits = [visit('A', 0), visit('B', 8), visit('C', 17), visit('D', 25), visit('E', 31)];
  assert.deepEqual([...automatedOutreachBurstIdentities(visits)].sort(), ['A', 'B', 'C', 'D', 'E']);
});

test('keeps ordinary visitors from the same location', () => {
  const visits = [visit('A', 0), visit('B', 180), visit('C', 360), visit('D', 540)];
  assert.equal(automatedOutreachBurstIdentities(visits).size, 0);
});

test('does not classify signed-in customers or unrelated direct traffic', () => {
  const visits = [
    visit('A', 0, { email: 'customer@example.com' }),
    visit('B', 5, { outreachId: '', utmSource: '' }),
    visit('C', 10, { city: 'Denver' }),
    visit('D', 15, { device: 'Safari · iPhone' }),
    visit('E', 20),
  ];
  assert.equal(automatedOutreachBurstIdentities(visits).size, 0);
});

test('flags the scanner identity so its later unattributed page is excluded too', () => {
  const visits = [visit('A', 0), visit('B', 5), visit('C', 10), visit('D', 15)];
  visits.push(visit('A', 20, { outreachId: '', path: '/signup' }));
  assert.equal(automatedOutreachBurstIdentities(visits).has('A'), true);
});

test('filters known crawlers, mail proxies, prefetches, webdriver sessions, and data-center cities', () => {
  assert.equal(isKnownAutomatedTraffic({ userAgent: 'Googlebot/2.1' }), true);
  assert.equal(isKnownAutomatedTraffic({ userAgent: 'GoogleImageProxy' }), true);
  assert.equal(isKnownAutomatedTraffic({ userAgent: 'Proofpoint URL Defense' }), true);
  assert.equal(isKnownAutomatedTraffic({ userAgent: 'Mimecast Security Scanner' }), true);
  assert.equal(isKnownAutomatedTraffic({ purpose: 'prefetch' }), true);
  assert.equal(isKnownAutomatedTraffic({ webdriver: true }), true);
  assert.equal(isKnownAutomatedTraffic({ city: 'Council+Bluffs' }), true);
  assert.equal(isKnownAutomatedTraffic({ userAgent: 'Mozilla/5.0 Safari/605.1.15', city: 'Salt Lake City' }), false);
});
