import { kv } from '@vercel/kv';
import { sendEmail } from '../lib/mailer.js';
import { getEmailLog, isSuppressed, logEmail } from '../lib/store.js';
import { outreachTokenFor, tokenFor } from '../lib/sign.js';

export const config = { maxDuration: 120 };

const CRON_SECRET = process.env.CRON_SECRET;
const FROM_EMAIL = process.env.OUTREACH_FROM_EMAIL || 'ty@nitrooutreach.com';
const FROM = `Nitro Outreach <${FROM_EMAIL}>`;
const REPLY_TO = process.env.OUTREACH_REPLY_TO || process.env.REPLY_TO || FROM_EMAIL;
const ADDRESS = '791 S 140 E, Farmington, UT 84025';
const MIN_AGE = 4 * 60 * 60 * 1000;
const MAX_AGE = 36 * 60 * 60 * 1000;
const DAILY_CAP = 5;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function mountainDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function reserveDailySlot() {
  const key = `outreach:followup:daily:${mountainDate()}`;
  const used = Number(await kv.incr(key));
  if (used === 1) await kv.expire(key, 172800);
  if (used > DAILY_CAP) { await kv.decr(key); return false; }
  return true;
}

function messageFor(entry) {
  const company = entry.contactName || 'your business';
  const subject = `Quick follow-up for ${company}`;
  const body = `Hi ${company} team,\n\nJust following up once in case the free Nitro setup would be useful. If you create the account, I’ll personally build the first real page or post around ${company} so you can judge the output before paying for anything.\n\nNo card and no sales call. Reply “build it” or start free here: https://nitrooutreach.com\n\nIf the timing is not right, no problem—I won’t keep chasing you.`;
  return { subject, body };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) { res.status(401).end('Unauthorized'); return; }

  const now = Date.now();
  const log = await getEmailLog(500);
  const firstConfirmed = await kv.hgetall('email:confirmed-visits:first');
  const sent = [];
  const errors = [];

  for (const entry of log) {
    if (sent.length >= DAILY_CAP) break;
    if (!entry?.id || !entry?.to || entry.followUpOf || entry.replied || entry.unsubscribed) continue;
    const confirmedAt = Number(firstConfirmed?.[entry.id] || 0);
    const age = now - confirmedAt;
    if (!confirmedAt || age < MIN_AGE || age > MAX_AGE) continue;
    const sentKey = `outreach:followup:sent:${entry.id}`;
    if (await kv.get(sentKey) || await isSuppressed(entry.to) || await kv.get(`customer:email:${String(entry.to).toLowerCase()}`)) continue;
    const reserved = await kv.set(sentKey, 'reserved', { nx: true, ex: 45 * 24 * 60 * 60 });
    if (!reserved) continue;
    if (!await reserveDailySlot()) { await kv.del(sentKey); break; }

    try {
      const { subject, body } = messageFor(entry);
      const trackingId = `${Date.now()}-f-${Math.random().toString(36).slice(2, 9)}`;
      const unsubscribeUrl = `https://nitrooutreach.com/unsubscribe?e=${encodeURIComponent(entry.to)}&t=${encodeURIComponent(tokenFor(entry.to))}`;
      const siteUrl = `https://nitrooutreach.com/start?utm_source=outreach&utm_medium=email&utm_campaign=engaged-followup&oid=${encodeURIComponent(trackingId)}&ot=${encodeURIComponent(outreachTokenFor(trackingId))}`;
      const html = escapeHtml(body).replaceAll('https://nitrooutreach.com', `<a href="${escapeHtml(siteUrl)}" style="display:inline-block;margin-top:6px;padding:11px 18px;border-radius:9px;background:#111827;color:#fff;font-weight:800;text-decoration:none">Start free</a>`).replace(/\n/g, '<br>');
      const footerText = `\n\n--\nTy Smith, Owner\nNitro Outreach\n${ADDRESS}\nUnsubscribe: ${unsubscribeUrl}`;
      const footerHtml = `<br><br>--<br>Ty Smith, Owner<br>Nitro Outreach<br>${escapeHtml(ADDRESS)}<br><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a><img src="https://nitrooutreach.com/api/track-open?id=${encodeURIComponent(trackingId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`;
      const result = await sendEmail({ from: FROM, to: entry.to, subject, text: body + footerText, html: html + footerHtml, reply_to: REPLY_TO, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, idempotencyKey: `nitro-engaged-followup-${entry.id}` });
      await kv.set(sentKey, String(result?.id || 'sent'), { ex: 365 * 24 * 60 * 60 });
      await logEmail({ id: trackingId, to: entry.to, subject, body, contactName: entry.contactName, timestamp: Date.now(), segment: 'engaged_followup', service: entry.service, businessLocation: entry.businessLocation, businessWebsite: entry.businessWebsite, industry: entry.industry, targetSegment: entry.targetSegment, providerId: result?.id || result?.messageId || '', status: 'sent', followUpOf: entry.id, sequence: 2 });
      sent.push(entry.to);
    } catch (error) {
      await kv.del(sentKey);
      errors.push({ id: entry.id, error: error.message });
    }
  }

  res.status(200).json({ sent: sent.length, dailyCap: DAILY_CAP, errors, timestamp: new Date().toISOString() });
}
