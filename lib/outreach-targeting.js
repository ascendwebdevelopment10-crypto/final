// Categories where an owner or very small team is likely to control marketing
// and read the public business inbox. This intentionally favors reply quality
// over raw send volume.
export const HIGH_RESPONSE_TYPES = new Set([
  'advertising_agency', 'consulting', 'it', 'photographer',
  'hairdresser', 'beauty', 'massage', 'tattoo', 'nail_salon',
  'car_wash', 'car_repair', 'tyres',
  'florist', 'bakery', 'jewelry', 'pet', 'bicycle',
  'fitness_centre', 'sports_centre', 'dance',
  'driving_school', 'travel_agency',
]);

export const AGENCY_TYPES = new Set(['advertising_agency', 'it', 'consulting', 'photographer']);

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
  if (!contact?.organization_name || contact?.isChain || !HIGH_RESPONSE_TYPES.has(industry)) return null;
  return AGENCY_TYPES.has(industry) ? 'Solo / small agency' : 'Owner-operated service business';
}

export function replyAngle(industry) {
  const value = String(industry || '').toLowerCase();
  if (['hairdresser', 'beauty', 'massage', 'tattoo', 'nail_salon'].includes(value)) return 'turn your work into consistent posts, keep your services online, and follow up with interested clients';
  if (['car_wash', 'car_repair', 'tyres'].includes(value)) return 'turn before-and-after jobs into content, keep your services online, and follow up with local leads';
  if (['fitness_centre', 'sports_centre', 'dance'].includes(value)) return 'keep your programs online, create useful content, and follow up with prospective members';
  if (['florist', 'bakery', 'jewelry', 'pet', 'bicycle'].includes(value)) return 'keep your products and offers online, create social content, and follow up with interested customers';
  if (AGENCY_TYPES.has(value)) return 'produce more client websites and content without adding another disconnected tool';
  return 'keep your website, content, and customer follow-up in one place';
}
