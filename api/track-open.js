import { trackEmailOpen } from '../lib/store.js';

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

export default async function handler(req, res) {
    const id = req.query.id;
    try {
          if (id) await trackEmailOpen(String(id));
    } catch (e) {
          // never fail the pixel response
    }
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Length', PIXEL_GIF.length);
    res.status(200).end(PIXEL_GIF);
}
