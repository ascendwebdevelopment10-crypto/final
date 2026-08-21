// Categories where an owner or very small team is likely to control marketing
// and read the public business inbox. This intentionally favors reply quality
// over raw send volume.
export const HIGH_RESPONSE_TYPES = new Set([
  'advertising_agency', 'photographer',
  'hairdresser', 'beauty', 'massage', 'tattoo', 'nail_salon',
  'car_wash', 'car_repair', 'tyres',
  'florist', 'bakery', 'jewelry', 'pet', 'bicycle',
  'fitness_centre', 'sports_centre', 'dance',
  'driving_school', 'travel_agency',
  'plumber', 'electrician', 'hvac', 'roofer', 'painter',
  'gardener', 'carpenter', 'locksmith',
]);

export const AGENCY_TYPES = new Set(['advertising_agency', 'photographer']);

const ENTERPRISE_NAME_PATTERN = /\b(university|college|hospital|health system|laborator(?:y|ies)|global|international|corporation|holdings|foundation|association|bank|credit union|municipality|department|alphagraphics)\b/i;
const LOW_INTENT_LOCALS = new Set([
  'abuse', 'accounting', 'billing', 'careers', 'feedback', 'hr', 'investors',
  'jobs', 'legal', 'media', 'press', 'privacy', 'security', 'webmaster', 'wholesale',
]);

const PUBLIC_INBOX_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com',
]);

export function emailMatchesBusinessWebsite(email, websiteUrl) {
  const address = String(email || '').trim().toLowerCase();
  const domain = address.split('@')[1] || '';
  if (!domain) return false;
  if (!websiteUrl) return true;
  if (PUBLIC_INBOX_DOMAINS.has(domain)) return true;
  try {
    const value = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : 'https://' + websiteUrl;
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    return domain === host || domain.endsWith('.' + host) || host.endsWith('.' + domain);
  } catch {
    return false;
  }
}

export function qualifyOutreachContact(contact) {
  const industry = String(contact?.industry || '').trim().toLowerCase();
  const name = String(contact?.organization_name || '').trim();
  if (!name || contact?.isChain || ENTERPRISE_NAME_PATTERN.test(name) || !HIGH_RESPONSE_TYPES.has(industry)) return null;
  return AGENCY_TYPES.has(industry) ? 'Solo / small agency' : 'Owner-operated service business';
}

export function isQualifiedOutreachEmail(email) {
  const local = String(email || '').trim().toLowerCase().split('@')[0] || '';
  return Boolean(local && !LOW_INTENT_LOCALS.has(local));
}

export function replyAngle(industry) {
  const value = String(industry || '').toLowerCase();
  if (['hairdresser', 'beauty', 'massage', 'tattoo', 'nail_salon'].includes(value)) return 'turn your work into consistent posts, keep your services online, and follow up with interested clients';
  if (['car_wash', 'car_repair', 'tyres'].includes(value)) return 'turn before-and-after jobs into content, keep your services online, and follow up with local leads';
  if (['fitness_centre', 'sports_centre', 'dance'].includes(value)) return 'keep your programs online, create useful content, and follow up with prospective members';
  if (['florist', 'bakery', 'jewelry', 'pet', 'bicycle'].includes(value)) return 'keep your products and offers online, create social content, and follow up with interested customers';
  if (AGENCY_TYPES.has(value)) return 'produce more client websites and content without adding another disconnected tool';
  if (['plumber', 'electrician', 'hvac', 'roofer', 'painter', 'gardener', 'carpenter', 'locksmith'].includes(value)) return 'show completed work, give local visitors a clear next step, and follow up with new inquiries';
  return 'keep your website, content, and customer follow-up in one place';
}

export function websiteOpportunity(html, industry) {
  const source = String(html || '');
  if (!source) return replyAngle(industry);
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) return 'make the website easier to use on mobile and give visitors a clear next step';
  const hasConversionAction = /(?:book|schedule|request (?:a )?quote|get (?:a )?quote|contact us|call (?:us|now)|shop now|order (?:now|online)|start (?:free|today)|get started)/i.test(source);
  if (!hasConversionAction) return 'give website visitors a clearer next step and follow up when they show interest';
  const hasSocialLink = /(?:instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com)/i.test(source);
  if (!hasSocialLink) return 'turn real work and offers into consistent social content while keeping the website and follow-up connected';
  return replyAngle(industry);
}
