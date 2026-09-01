import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedCaptionNeedsReview, generatedTextHasUnsafeLanguage, safeGeneratedBusinessName } from '../lib/social-quality.js';

test('generated social captions block empty, broken, or unsafe copy', () => {
  assert.equal(generatedCaptionNeedsReview(''), true);
  assert.equal(generatedCaptionNeedsReview('nigf should make the next move easier'), true);
  assert.equal(generatedCaptionNeedsReview('A useful marketing system keeps the next step clear.'), false);
});

test('unsafe language can be checked independently of caption length', () => {
  assert.equal(generatedTextHasUnsafeLanguage('nigf'), true);
  assert.equal(generatedTextHasUnsafeLanguage('Nitro Outreach'), false);
});

test('unsafe stored business names never reach generated social copy', () => {
  assert.equal(safeGeneratedBusinessName('nigf'), 'Nitro Outreach');
  assert.equal(safeGeneratedBusinessName('  Acme Plumbing  '), 'Acme Plumbing');
  assert.equal(safeGeneratedBusinessName(''), 'Nitro Outreach');
});
