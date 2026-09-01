const UNSAFE_GENERATED_TEXT = /\b(?:nig[a-z]*|fag[a-z]*|retard(?:ed)?|cunt|kike|spic)\b/i;

export function generatedTextHasUnsafeLanguage(value) {
  return UNSAFE_GENERATED_TEXT.test(String(value || ''));
}

export function safeGeneratedBusinessName(value, fallback = 'Nitro Outreach') {
  const name = String(value || '').trim().slice(0, 120);
  return !name || generatedTextHasUnsafeLanguage(name) ? fallback : name;
}

export function generatedCaptionNeedsReview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return !text || text.length < 12 || generatedTextHasUnsafeLanguage(text);
}
