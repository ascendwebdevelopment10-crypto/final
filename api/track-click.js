import { trackEmailClick } from '../lib/store.js';

const FALLBACK_URL = 'https://ascendwebdevelopment.com';

function safeTarget(raw) {
    if (!raw) return FALLBACK_URL;
    try {
          const decoded = decodeURIComponent(raw);
          const u = new URL(decoded);
          if (u.protocol === 'http:' || u.protocol === 'https:') return decoded;
          return FALLBACK_URL;
    } catch (e) {
          return FALLBACK_URL;
    }
}

export default async function handler(req, res) {
    const id = req.query.id;
    const target = safeTarget(req.query.url);
    try {
          if (id) await trackEmailClick(String(id), target);
    } catch (e) {
          // never block the redirect
    }
    res.writeHead(302, { Location: target });
    res.end();
}
