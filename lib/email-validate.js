// Rejects scraped "emails" that are actually filenames or code artifacts
// (e.g. "lawnlovecom-hero-375w@1x-DcBMp8QT.webp" from an image srcset).
const FILE_EXT_TLDS = new Set(['png','jpg','jpeg','webp','svg','gif','ico','avif','bmp','tif','tiff','css','js','mjs','cjs','json','xml','html','htm','php','asp','aspx','woff','woff2','ttf','otf','eot','mp4','webm','mov','mp3','wav','ogg','pdf','zip','gz','rar','map','txt','md','yml','yaml','ts','tsx','jsx','scss','less']);


// Common template/sample addresses scraped from website boilerplate — valid
// syntax but never real inboxes, so they bounce. Reject them outright.
const PLACEHOLDER_EMAILS = new Set([
  'info@mysite.com','user@domain.com','email@address.com','name@email.com',
  'name@example.com','you@example.com','your@email.com','yourname@email.com',
  'yourname@example.com','example@example.com','test@test.com','test@example.com',
  'sample@email.com','email@domain.com','john@example.com','johndoe@example.com',
  'firstname.lastname@example.com','someone@example.com','hello@example.com',
  'contact@example.com','admin@example.com','noreply@example.com','no-reply@example.com',
]);
const PLACEHOLDER_DOMAINS = new Set([
  'example.com','example.org','example.net','domain.com','yourdomain.com',
  'email.com','mysite.com','yoursite.com','website.com','sentry.io','sentry-next.wixpress.com',
]);
const PLACEHOLDER_LOCALS = new Set([
  'youremail','your-email','your_email','yourname','your-name','firstname',
  'lastname','firstnamelastname','name','email','username',
]);

export function isLikelyRealEmail(raw) {
  if (!raw) return false;
  const e = String(raw).trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return false;
  const m = e.match(/^([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.([a-z]{2,24})$/);
  if (!m) return false;
  const [, local, domain, tld] = m;
  if (PLACEHOLDER_EMAILS.has(e)) return false;
  if (PLACEHOLDER_DOMAINS.has(domain + '.' + tld)) return false;
  if (PLACEHOLDER_LOCALS.has(local)) return false;
  if (FILE_EXT_TLDS.has(tld)) return false;            // filename extension, not a TLD
  if (/^\d+x(-|$)/.test(domain)) return false;         // srcset artifact: name@1x-hash.ext
  if (local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.includes('..') || domain.startsWith('-') || domain.endsWith('-')) return false;
  return true;
}
