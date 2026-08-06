import { kv } from '@vercel/kv';
import { getEmailLog, trackEmailOpen } from '../lib/store.js';

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

async function notifyFirstOpen(id) {
    // Mail clients and security scanners can request the pixel repeatedly.
    // Keep phone alerts to the first request for each outreach email.
    const log = await getEmailLog(300);
    const entry = log.find(item => String(item?.id || '') === id);
    if (!entry) return;
    const firstNotification = await kv.set(`outreach:open-notified:${id}`, String(Date.now()), {
        nx: true,
        ex: 60 * 60 * 24 * 180,
    });
    if (!firstNotification) return;

    const business = String(entry?.contactName || 'an outreach recipient').trim();
    const recipient = String(entry?.to || '').trim();
    const topic = process.env.NTFY_TOPIC || 'nitro-replies';
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
            Title: `Open detected: ${business}`,
            Priority: 'default',
            Tags: 'email,eyes',
            Click: 'https://nitrooutreach.com/app#outreach',
            'Content-Type': 'text/plain',
        },
        body: `${recipient || 'The recipient'} triggered the email tracking pixel. This may be a real open, mail preloading, or a security scanner.`,
    });
}

export default async function handler(req, res) {
    const id = req.query.id;
    try {
          if (id) {
              const trackingId = String(id);
              const alreadyOpened = await kv.hget('email:opens:first', trackingId);
              await trackEmailOpen(trackingId);
              if (!alreadyOpened) {
                  try { await notifyFirstOpen(trackingId); } catch (e) { console.error('Open push notification failed:', e.message); }
              }
          }
    } catch (e) {
          // never fail the pixel response
    }
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Length', PIXEL_GIF.length);
    res.status(200).end(PIXEL_GIF);
}
