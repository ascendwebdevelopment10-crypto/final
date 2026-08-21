import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedCaptionNeedsReview } from '../lib/social-quality.js';

test('generated social captions block empty, broken, or unsafe copy', () => {
  assert.equal(generatedCaptionNeedsReview(''), true);
  assert.equal(generatedCaptionNeedsReview('nigf should make the next move easier'), true);
  assert.equal(generatedCaptionNeedsReview('A useful marketing system keeps the next step clear.'), false);
});
