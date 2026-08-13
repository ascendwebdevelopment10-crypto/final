import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichVisitorsWithOutreach } from '../api/owner-data.js';

test('keeps individual browsers separate while attaching the tracked business', () => {
  const visitors = [
    {
      visitorId: 'BROWSER1',
      city: 'Washington',
      sessions: [{ outreachId: 'send-1' }],
    },
    {
      visitorId: 'BROWSER2',
      city: 'Washington',
      sessions: [{ outreachId: 'send-2' }],
    },
  ];
  const result = enrichVisitorsWithOutreach(visitors, [
    { id: 'send-1', contactName: 'Peak Detail', to: 'hello@peakdetail.com', businessLocation: 'Denver CO' },
    { id: 'send-2', contactName: 'Moth & Sage', to: 'team@mothandsage.com', businessLocation: 'Portland OR' },
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map(visitor => visitor.businessName), ['Peak Detail', 'Moth & Sage']);
  assert.deepEqual(result.map(visitor => visitor.businessLocation), ['Denver CO', 'Portland OR']);
  assert.notEqual(result[0].visitorId, result[1].visitorId);
});

test('leaves direct visitors anonymous instead of inventing a business', () => {
  const [visitor] = enrichVisitorsWithOutreach([{ visitorId: 'DIRECT1', sessions: [] }], []);
  assert.equal(visitor.businessName, undefined);
  assert.equal(visitor.businessLocation, undefined);
});
