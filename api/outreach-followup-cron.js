import { kv } from '@vercel/kv';
import { sendEmail } from '../lib/mailer.js';
import { getEmailEngagement, getEmailLog, getReplies, isSuppressed, logEmail } from '../lib/store.js';
import { outreachTokenFor, tokenFor } from '../lib/sign.js';
import { chooseFollowupCandidates, followupMessage } from '../lib/outreach-followup.js';

export const config = { maxDuration: 120 };

const CRON_SECRET = process.env.CRON_SECRET;
const FROM_EMAIL = process.env.OUTREACH_FROM_EMAIL || 'ty@nitrooutreach.com';
const FROM = `Nitro Outreach <${FROM_EMAIL}>`;
const REPLY_TO = process.env.OUTREACH_REPLY_TO || process.env.REPLY_TO || FROM_EMAIL;
const ADDRESS = '791 S 140 E, Farmington, UT 84025';
const PROVIDER_DAILY_CAP = 100;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function mountainDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function reserveProviderSlot() {
  const date = mountainDate();
  const key = `outreach:email:all-daily-reserved:${date}`;
  const baseline = Number(await kv.get(`stats:daily:${date}`)) || 0;
  await kv.set(key, String(baseline), { nx: true, ex: 172800 });
  const used = Number(await kv.incr(key));
  if (used > PROVIDER_DAILY_CAP) { await kv.decr(key); return null; }
  return key;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) { res.status(401).end('Unauthorized'); return; }

  const now = Date.now();
  const [rawLog, engagement, firstConfirmed, confirmedCounts, replies] = await Promise.all([
    getEmailLog(null), getEmailEngagement(), kv.hgetall('email:confirmed-visits:first'),
    kv.hgetall('email:confirmed-visits:count'), getReplies(2000),
  ]);
  const replied = new Set((replies || []).map(reply => String(reply?.from || '').toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1')));
  const log = rawLog.map(entry => ({
    ...entry,
    replied: entry.replied || replied.has(String(entry.to || '').toLowerCase()),
    opened: Number(engagement.opens?.[entry.id] || 0) > 0,
    openCount: Number(engagement.opens?.[entry.id] || 0),
    knownAutomatedOpenCount: Number(engagement.automatedOpens?.[entry.id] || 0),
    firstOpenedAt: Number(engagement.opensFirst?.[entry.id] || 0) || null,
    lastOpenedAt: Number(engagement.opensLast?.[entry.id] || 0) || null,
    confirmedVisit: Number(confirmedCounts?.[entry.id] || 0) > 0,
    firstConfirmedAt: Number(firstConfirmed?.[entry.id] || 0) || null,
  }));
  const candidates = chooseFollowupCandidates(log, new Set(), now);
  const sent = [];
  const errors = [];

  for (const candidate of candidates) {
    const { entry, sequence, intent } = candidate;
    const sentKey = `outreach:followup:sent:${entry.id}:${sequence}`;
    const legacySent = sequence === 2 ? await kv.get(`outreach:followup:sent:${entry.id}`) : null;
    if (legacySent || await kv.get(sentKey) || await isSuppressed(entry.to) || await kv.get(`customer:email:${String(entry.to).toLowerCase()}`)) continue;
    const reserved = await kv.set(sentKey, 'reserved', { nx: true, ex: 45 * 24 * 60 * 60 });
    if (!reserved) continue;
    const providerKey = await reserveProviderSlot();
    if (!providerKey) { await kv.del(sentKey); break; }

    try {
      const { subject, body } = followupMessage(entry, sequence);
      const trackingId = `${Date.now()}-f${sequence}-${Math.random().toString(36).slice(2, 9)}`;
      const unsubscribeUrl = `https://nitrooutreach.com/unsubscribe?e=${encodeURIComponent(entry.to)}&t=${encodeURIComponent(tokenFor(entry.to))}`;
      const campaign = 'confirmed-visit-followup';
      const siteUrl = `https://nitrooutreach.com/start?utm_source=outreach&utm_medium=email&utm_campaign=${campaign}&oid=${encodeURIComponent(trackingId)}&ot=${encodeURIComponent(outreachTokenFor(trackingId))}`;
      const html = escapeHtml(body).replaceAll('nitrooutreach.com', `<a href="${escapeHtml(siteUrl)}" style="color:#111827;font-weight:700;text-decoration:underline">nitrooutreach.com</a>`).replace(/\n/g, '<br>');
      const footerText = `\n\n--\nTy Smith, Owner\nNitro Outreach\n${ADDRESS}\nUnsubscribe: ${unsubscribeUrl}`;
      const footerHtml = `<br><br>--<br>Ty Smith, Owner<br>Nitro Outreach<br>${escapeHtml(ADDRESS)}<br><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a><img src="https://nitrooutreach.com/api/track-open?id=${encodeURIComponent(trackingId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`;
      const result = await sendEmail({ from: FROM, to: entry.to, subject, text: body + footerText, html: html + footerHtml, reply_to: REPLY_TO, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, idempotencyKey: `nitro-intent-followup-${entry.id}-${sequence}` });
      await kv.set(sentKey, String(result?.id || 'sent'), { ex: 365 * 24 * 60 * 60 });
      await logEmail({ id: trackingId, to: entry.to, subject, body, contactName: entry.contactName, timestamp: Date.now(), segment: campaign.replaceAll('-', '_'), service: entry.service, businessLocation: entry.businessLocation, businessWebsite: entry.businessWebsite, industry: entry.industry, targetSegment: entry.targetSegment, providerId: result?.id || result?.messageId || '', status: 'sent', followUpOf: entry.id, sequence });
      sent.push(entry.to);
    } catch (error) {
      await kv.del(sentKey);
      await kv.decr(providerKey).catch(() => {});
      errors.push({ id: entry.id, error: error.message });
    }
  }

  res.status(200).json({ sent: sent.length, eligible: candidates.length, providerDailyCap: PROVIDER_DAILY_CAP, errors, timestamp: new Date().toISOString() });
}
