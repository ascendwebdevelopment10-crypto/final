import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedCaptionNeedsReview, generatedTextHasUnsafeLanguage } from '../lib/social-quality.js';

test('generated social captions block empty, broken, or unsafe copy', () => {
  assert.equal(generatedCaptionNeedsReview(''), true);
  assert.equal(generatedCaptionNeedsReview('nigf should make the next move easier'), true);
  assert.equal(generatedCaptionNeedsReview('A useful marketing system keeps the next step clear.'), false);
});

test('unsafe language can be checked independently of caption length', () => {
  assert.equal(generatedTextHasUnsafeLanguage('nigf'), true);
  assert.equal(generatedTextHasUnsafeLanguage('Nitro Outreach'), false);
});
