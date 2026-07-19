import instagramHandler from './instagram.js';

export const config = { maxDuration: 60 };

// Instagram OAuth requires an exact, stable redirect URI. Keep the public
// callback free of query-string routing so Meta can validate it reliably.
export default async function handler(req, res) {
  req.query = { ...(req.query || {}), action: 'callback' };
  return instagramHandler(req, res);
}
