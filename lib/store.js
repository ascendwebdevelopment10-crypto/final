import { kv } from '@vercel/kv';

export async function logEmail({ to, subject, contactId, timestamp, segment }) {
  const entry = { type: 'email', to, subject, contactId, timestamp: timestamp || Date.now(), replied: false, unsubscribed: false, segment: segment || 'general' };
  await kv.lpush('email:log', JSON.stringify(entry));
  await kv.incr('stats:total_sent');
  const today = new Date().toISOString().split('T')[0];
  await kv.incr(`stats:daily:${today}`);
}

export async function logSms({ to, body, contactId, timestamp, segment }) {
  const entry = { type: 'sms', to, body, contactId, timestamp: timestamp || Date.now(), replied: false, segment: segment || 'general' };
  await kv.lpush('sms:log', JSON.stringify(entry));
  await kv.incr('stats:sms_total_sent');
  const today = new Date().toISOString().split('T')[0];
  await kv.incr(`stats:sms_daily:${today}`);
}

export async function logReply({ from, subject, body, timestamp, originalTo, thread }) {
  const entry = {
    from,
    subject: subject || '(no subject)',
    body: body || '',
    timestamp: timestamp || Date.now(),
    originalTo,
    thread: thread || null,
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  };
  await kv.lpush('replies:log', JSON.stringify(entry));
  await kv.incr('stats:replies');
  // Mark the outbound email as replied
  const log = await getEmailLog(500);
  const updated = log.map(e => e.to === from ? { ...e, replied: true } : e);
  await kv.del('email:log');
  for (const e of updated.reverse()) await kv.lpush('email:log', JSON.stringify(e));
}

export async function getReplies(limit = 100) {
  const raw = await kv.lrange('replies:log', 0, limit - 1);
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

export async function getEmailLog(limit = 100) {
  const raw = await kv.lrange('email:log', 0, limit - 1);
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

export async function getSmsLog(limit = 100) {
  const raw = await kv.lrange('sms:log', 0, limit - 1);
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

export async function markReplied(contactId, type = 'email') {
  if (type === 'sms') {
    const log = await getSmsLog(500);
    const updated = log.map(e => e.contactId === contactId ? { ...e, replied: true } : e);
    await kv.del('sms:log');
    for (const e of updated.reverse()) await kv.lpush('sms:log', JSON.stringify(e));
    await kv.incr('stats:sms_replies');
  } else {
    const log = await getEmailLog(500);
    const updated = log.map(e => e.contactId === contactId ? { ...e, replied: true } : e);
    await kv.del('email:log');
    for (const e of updated.reverse()) await kv.lpush('email:log', JSON.stringify(e));
    await kv.incr('stats:replies');
  }
}

export async function addToSuppression(email) {
  await kv.sadd('suppression:emails', email.toLowerCase());
  await kv.incr('stats:unsubscribed');
}

export async function isSuppressed(email) {
  return await kv.sismember('suppression:emails', email.toLowerCase());
}

export async function getTotalStats() {
  const [total, replies, unsubscribed, smsTotal, smsReplies] = await Promise.all([
    kv.get('stats:total_sent'),
    kv.get('stats:replies'),
    kv.get('stats:unsubscribed'),
    kv.get('stats:sms_total_sent'),
    kv.get('stats:sms_replies')
  ]);
  const today = new Date().toISOString().split('T')[0];
  const [todayEmail, todaySms] = await Promise.all([
    kv.get(`stats:daily:${today}`),
    kv.get(`stats:sms_daily:${today}`)
  ]);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const [emailCount, smsCount] = await Promise.all([
      kv.get(`stats:daily:${key}`),
      kv.get(`stats:sms_daily:${key}`)
    ]);
    days.push({ date: key, emails: parseInt(emailCount || 0), sms: parseInt(smsCount || 0) });
  }
  return {
    totalEmailSent: parseInt(total || 0),
    emailReplies: parseInt(replies || 0),
    unsubscribed: parseInt(unsubscribed || 0),
    todayEmailSent: parseInt(todayEmail || 0),
    totalSmsSent: parseInt(smsTotal || 0),
    smsReplies: parseInt(smsReplies || 0),
    todaySmsSent: parseInt(todaySms || 0),
    dailyChart: days
  };
}
