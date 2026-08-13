export const LEGACY_REEL_TO_CONTENT_MULTIPLIER = 5;

export function contentCreditBalance(user) {
  const usage = user?.usage || {};
  if (Number.isFinite(Number(usage.contentCredits))) return Math.max(0, Number(usage.contentCredits));
  return Math.max(0, Number(usage.videoCredits || 0) * LEGACY_REEL_TO_CONTENT_MULTIPLIER);
}

export function migrateContentCredits(user) {
  user.usage = user.usage || {};
  if (!Number.isFinite(Number(user.usage.contentCredits))) {
    user.usage.contentCredits = contentCreditBalance(user);
  }
  return user.usage.contentCredits;
}

export function spendContentCredits(user, cost) {
  const balance = migrateContentCredits(user);
  if (balance < cost) return false;
  user.usage.contentCredits = balance - cost;
  return true;
}
