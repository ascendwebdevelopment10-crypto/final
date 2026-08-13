import assert from 'node:assert/strict';
import test from 'node:test';
import { emailMatchesBusinessWebsite, qualifyOutreachContact, replyAngle } from '../lib/outreach-targeting.js';

test('prioritizes owner-operated categories with high reply potential', () => {
  assert.equal(qualifyOutreachContact({ organization_name: 'Peak Detail', industry: 'car_wash' }), 'Owner-operated service business');
  assert.equal(qualifyOutreachContact({ organization_name: 'Moth & Sage', industry: 'advertising_agency' }), 'Solo / small agency');
  assert.equal(qualifyOutreachContact({ organization_name: 'Big Chain', industry: 'beauty', isChain: true }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'Medical Group', industry: 'clinic' }), null);
});

test('uses an industry-specific reason to reply', () => {
  assert.match(replyAngle('hairdresser'), /consistent posts/);
  assert.match(replyAngle('car_wash'), /before-and-after/);
  assert.match(replyAngle('advertising_agency'), /client websites/);
});

test('keeps business-owned and public inboxes but rejects unrelated vendor addresses', () => {
  assert.equal(emailMatchesBusinessWebsite('hello@peakdetail.com', 'https://peakdetail.com/services'), true);
  assert.equal(emailMatchesBusinessWebsite('owner@gmail.com', 'https://peakdetail.com'), true);
  assert.equal(emailMatchesBusinessWebsite('support@bloomnation.com', 'https://beaumontflorist.com'), false);
  assert.equal(emailMatchesBusinessWebsite('accessibility@hidethellama.com', 'https://taronbakery.com'), false);
  assert.equal(emailMatchesBusinessWebsite('abc123@sentry.wixpress.com', 'https://localshop.com'), false);
});
