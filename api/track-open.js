import { kv } from '@vercel/kv';
import { getEmailLog, trackEmailOpen } from '../lib/store.js';
import { notifyBestEffort } from '../lib/ntfy.js';
import { isKnownAutomatedTraffic } from '../lib/analytics-traffic.js';

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
    await notifyBestEffort({
        title: `Email opened: ${business}`,
        message: `${recipient || 'The recipient'} loaded the tracking pixel. This can be a real open, mail preload, or security scanner.`,
        priority: 'default',
        tags: 'email,eyes',
        click: 'https://nitrooutreach.com/app#outreach',
    });
}

export default async function handler(req, res) {
    const id = req.query.id;
    try {
          if (id) {
              const trackingId = String(id);
              const automated = isKnownAutomatedTraffic({
                  userAgent: req.headers['user-agent'],
                  purpose: req.headers.purpose || req.headers['sec-purpose'],
                  city: req.headers['x-vercel-ip-city'],
              });
              const alreadyOpened = await kv.hget('email:opens:first', trackingId);
              await trackEmailOpen(trackingId, { automated });
              if (!automated && !alreadyOpened) {
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
