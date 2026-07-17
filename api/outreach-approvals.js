import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import { kv } from '@vercel/kv';
import { isAuthorized } from '../lib/auth.js';
import { isLikelyRealEmail } from '../lib/email-validate.js';
import { sendEmail, FROM_EMAIL } from '../lib/mailer.js';
import { tokenFor } from '../lib/sign.js';
import {
  isSuppressed,
  wasEmailed,
  markEmailed,
  logEmail,
  logSms,
  logNotSent,
  isExcludedPhone,
} from '../lib/store.js';

export const config = { maxDuration: 120 };

const INDEX_KEY = 'outreach:approvals:index';
const ITEM_PREFIX = 'outreach:approval:';
const LOCK_PREFIX = 'outreach:approval:lock:';
const MAX_ITEMS = 100;
const BASE_URL = process.env.BASE_URL || 'https://final-phi-swart.vercel.app';
const PHYSICAL_ADDRESS = process.env.PHYSICAL_ADDRESS || '14234 S Canyon Vine Cove';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value) {
  const digits = clean(value, 30).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseItem(value) {
  if (!value) return null;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}

async function getItem(id) {
  return parseItem(await kv.get(ITEM_PREFIX + id));
}

async function saveItem(item) {
  await kv.set(ITEM_PREFIX + item.id, JSON.stringify(item));
  return item;
}

async function listItems() {
  const ids = await kv.lrange(INDEX_KEY, 0, MAX_ITEMS - 1);
  const items = await Promise.all((ids || []).map(id => getItem(String(id))));
  return items.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function publicItem(item) {
  const { providerId, ...safe } = item;
  return safe;
}

async function createItem(body) {
  const channel = clean(body.channel, 10).toLowerCase();
  if (!['email', 'sms'].includes(channel)) throw new Error('Channel must be email or SMS');

  const recipient = channel === 'email'
    ? clean(body.recipient, 254).toLowerCase()
    : normalizePhone(body.recipient);
  if (channel === 'email' && !isLikelyRealEmail(recipient)) throw new Error('Enter a valid business email');
  if (channel === 'sms' && !recipient) throw new Error('Enter a valid US phone number');
  if (channel === 'sms' && isExcludedPhone(recipient)) throw new Error('This phone number is excluded from outreach');

  const message = clean(body.message, channel === 'sms' ? 1200 : 12000);
  if (!message) throw new Error('Message is required');

  const item = {
    id: randomUUID(),
    status: 'pending',
    channel,
    recipient,
    contactName: clean(body.contactName, 160),
    campaign: clean(body.campaign, 160) || 'AI Agent outreach',
    subject: channel === 'email' ? (clean(body.subject, 240) || 'Quick question') : '',
    message,
    source: clean(body.source, 40) || 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveItem(item);
  await kv.lpush(INDEX_KEY, item.id);
  await kv.ltrim(INDEX_KEY, 0, MAX_ITEMS - 1);
  return item;
}

async function suppressionReason(item) {
  if (item.channel === 'email') {
    if (await isSuppressed(item.recipient)) return 'Email address is suppressed or unsubscribed';
    if (await wasEmailed(item.recipient)) return 'This email address has already been contacted';
    return '';
  }
  if (isExcludedPhone(item.recipient)) return 'Phone number is excluded from outreach';
  const allDigits = item.recipient.replace(/\D/g, '');
  const digits = allDigits.slice(-10);
  if (await kv.get('suppress:phone:' + digits)) return 'Phone number has opted out';
  const [contactedFull, contactedLocal] = await Promise.all([
    kv.sismember('sms:contacted_numbers', allDigits),
    kv.sismember('sms:contacted_numbers', digits),
  ]);
  if (contactedFull || contactedLocal) return 'This phone number has already been contacted';
  return '';
}

async function sendApproved(item) {
  const reason = await suppressionReason(item);
  if (reason) {
    await logNotSent(1);
    throw new Error(reason);
  }

  if (item.channel === 'email') {
    const token = tokenFor(item.recipient);
    const unsubscribeUrl = BASE_URL + '/unsubscribe?e=' + encodeURIComponent(item.recipient) + '&t=' + encodeURIComponent(token);
    const footer = '\n\n--\nTy Smith, Owner\nAscend Web Development\n' + PHYSICAL_ADDRESS + '\nUnsubscribe: ' + unsubscribeUrl;
    const text = item.message + footer;
    const html = '<p>' + escapeHtml(item.message).replace(/\n/g, '<br>') + '</p><p style="color:#64748b;font-size:12px">--<br>Ty Smith, Owner<br>Ascend Web Development<br>' + escapeHtml(PHYSICAL_ADDRESS) + '<br><a href="' + escapeHtml(unsubscribeUrl) + '">Unsubscribe</a></p>';
    const result = await sendEmail({
      from: 'Ascend Web Development <' + FROM_EMAIL + '>',
      to: item.recipient,
      subject: item.subject,
      text,
      html,
      reply_to: process.env.REPLY_TO || FROM_EMAIL,
    });
    const providerId = result?.id || result?.messageId || '';
    await logEmail({
      to: item.recipient,
      subject: item.subject,
      body: item.message,
      contactName: item.contactName,
      timestamp: Date.now(),
      segment: 'agent_approved',
      service: 'website',
      id: providerId || undefined,
    });
    await markEmailed(item.recipient);
    return providerId;
  }

  const stopLine = /reply\s+stop/i.test(item.message) ? '' : '\nReply STOP to opt out.';
  const body = item.message + stopLine;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const result = await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: item.recipient,
  });
  await logSms({
    to: item.recipient,
    body,
    contactName: item.contactName,
    timestamp: Date.now(),
    segment: 'agent_approved',
    service: 'website',
  });
  await kv.sadd('sms:contacted_numbers', item.recipient.replace(/\D/g, ''));
  return result.sid || '';
}

async function approveItem(id) {
  const item = await getItem(id);
  if (!item) throw new Error('Approval item not found');
  if (item.status !== 'pending') throw new Error('Only pending items can be approved');

  const locked = await kv.set(LOCK_PREFIX + id, '1', { nx: true, ex: 120 });
  if (!locked) throw new Error('This item is already being processed');

  item.status = 'sending';
  item.updatedAt = Date.now();
  await saveItem(item);
  try {
    item.providerId = await sendApproved(item);
    item.status = 'sent';
    item.sentAt = Date.now();
    item.updatedAt = item.sentAt;
    await saveItem(item);
    return item;
  } catch (error) {
    item.status = 'blocked';
    item.error = clean(error.message, 500);
    item.updatedAt = Date.now();
    await saveItem(item);
    throw error;
  } finally {
    await kv.del(LOCK_PREFIX + id);
  }
}

async function rejectItem(id) {
  const item = await getItem(id);
  if (!item) throw new Error('Approval item not found');
  if (item.status !== 'pending') throw new Error('Only pending items can be rejected');
  item.status = 'rejected';
  item.rejectedAt = Date.now();
  item.updatedAt = item.rejectedAt;
  return saveItem(item);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    if (req.method === 'GET') {
      const items = (await listItems()).map(publicItem);
      const counts = items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});
      res.status(200).json({ items, counts });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const action = clean(req.body?.action, 20).toLowerCase();
    if (action === 'create') {
      const item = await createItem(req.body || {});
      res.status(201).json({ ok: true, item: publicItem(item) });
      return;
    }
    if (action === 'approve') {
      const item = await approveItem(clean(req.body?.id, 80));
      res.status(200).json({ ok: true, item: publicItem(item) });
      return;
    }
    if (action === 'reject') {
      const item = await rejectItem(clean(req.body?.id, 80));
      res.status(200).json({ ok: true, item: publicItem(item) });
      return;
    }
    res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Outreach approval error:', error.message);
    const status = /not found/i.test(error.message) ? 404 : /suppressed|opted out|already|excluded/i.test(error.message) ? 409 : 400;
    res.status(status).json({ error: error.message || 'Approval workflow failed' });
  }
}
