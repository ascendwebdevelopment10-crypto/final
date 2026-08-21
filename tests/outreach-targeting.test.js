import assert from 'node:assert/strict';
import test from 'node:test';
import { emailMatchesBusinessWebsite, isQualifiedOutreachEmail, qualifyOutreachContact, replyAngle, websiteOpportunity } from '../lib/outreach-targeting.js';
import { OUTREACH_OSM_TAGS } from '../lib/leads.js';

test('prioritizes owner-operated categories with high reply potential', () => {
  assert.equal(qualifyOutreachContact({ organization_name: 'Peak Detail', industry: 'car_wash' }), 'Owner-operated service business');
  assert.equal(qualifyOutreachContact({ organization_name: 'Moth & Sage', industry: 'advertising_agency' }), 'Solo / small agency');
  assert.equal(qualifyOutreachContact({ organization_name: 'Big Chain', industry: 'beauty', isChain: true }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'Medical Group', industry: 'clinic' }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'Silicon Labs', industry: 'it' }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'AlphaGraphics Downtown', industry: 'advertising_agency' }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'State University Florist', industry: 'florist' }), null);
  assert.equal(qualifyOutreachContact({ organization_name: 'Peak Plumbing', industry: 'plumber' }), 'Owner-operated service business');
});

test('rejects low-intent departmental inboxes', () => {
  assert.equal(isQualifiedOutreachEmail('hello@peakdetail.com'), true);
  assert.equal(isQualifiedOutreachEmail('owner@gmail.com'), true);
  assert.equal(isQualifiedOutreachEmail('feedback@localshop.com'), false);
  assert.equal(isQualifiedOutreachEmail('wholesale@bakery.com'), false);
});

test('uses an industry-specific reason to reply', () => {
  assert.match(replyAngle('hairdresser'), /consistent posts/);
  assert.match(replyAngle('car_wash'), /before-and-after/);
  assert.match(replyAngle('advertising_agency'), /client websites/);
  assert.match(replyAngle('roofer'), /completed work/);
});

test('uses observable website gaps for careful personalization', () => {
  assert.match(websiteOpportunity('<html><body>Call us</body></html>', 'florist'), /mobile/);
  assert.match(websiteOpportunity('<meta name="viewport" content="width=device-width"><p>Welcome</p>', 'florist'), /clearer next step/);
  assert.match(websiteOpportunity('<meta name="viewport" content="width=device-width"><a>Book now</a>', 'florist'), /social content/);
});

test('keeps business-owned and public inboxes but rejects unrelated vendor addresses', () => {
  assert.equal(emailMatchesBusinessWebsite('hello@peakdetail.com', 'https://peakdetail.com/services'), true);
  assert.equal(emailMatchesBusinessWebsite('owner@gmail.com', 'https://peakdetail.com'), true);
  assert.equal(emailMatchesBusinessWebsite('support@bloomnation.com', 'https://beaumontflorist.com'), false);
  assert.equal(emailMatchesBusinessWebsite('accessibility@hidethellama.com', 'https://taronbakery.com'), false);
  assert.equal(emailMatchesBusinessWebsite('abc123@sentry.wixpress.com', 'https://localshop.com'), false);
});

test('lead discovery only requests categories accepted by outreach targeting', () => {
  for (const tag of OUTREACH_OSM_TAGS) {
    const industry = tag.split('=')[1];
    assert.ok(qualifyOutreachContact({ organization_name: 'Independent Business', industry }), tag);
  }
});
