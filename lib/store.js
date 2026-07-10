import { kv } from '@vercel/kv';

// Businesses / phone numbers we must never contact on ANY channel.
// The Joint Chiropractic is a nationwide franchise that kept resurfacing in
// scraped results and has opted out; +1 844-656-1149 is one of its lines.
export const EXCLUDED_NAME_PATTERNS = [
  /the\s*joint\s*chiropractic/i,
  /\bthe\s*joint\b/i,
];
export const EXCLUDED_PHONES = new Set(['18446561149']);
export function isExcludedBusiness(name) {
  return EXCLUDED_NAME_PATTERNS.some(p => p.test(name || ''));
}
export function isExcludedPhone(phone) {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return false;
  const withCc = d.length === 10 ? '1' + d : d;
  return EXCLUDED_PHONES.has(d) || EXCLUDED_PHONES.has(withCc);
}
function mtDateStr(offsetDays) {
        	const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
        	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function logEmail({ to, subject, body, contactName, contactId, timestamp, segment, service, id }) {
        const emailId = id || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
        const entry = { type: 'email', id: emailId, to, subject, body: body || '', contactName: contactName || '', contactId, timestamp: timestamp || Date.now(), replied: false, unsubscribed: false, segment: segment || 'general', service: service || 'website' };
        await kv.lpush('email:log', JSON.stringify(entry));
        await kv.incr('stats:total_sent');
        		const today = mtDateStr();
        await kv.incr(`stats:daily:${today}`);
        return emailId;
}

export async function logSms({ to, body, contactName, contactId, timestamp, segment, service, isFollowUp }) {
      const entry = { type: 'sms', to, body, contactName: contactName || '', contactId, timestamp: timestamp || Date.now(), replied: false, followedUp: isFollowUp ? true : false, segment: segment || 'general', service: service || 'website' };
      await kv.lpush('sms:log', JSON.stringify(entry));
      await kv.incr('stats:sms_total_sent');
            const today = mtDateStr();
      await kv.incr(`stats:sms_daily:${today}`);
      if (isFollowUp) await kv.incr('stats:followup_sms');
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

export async function getCallLog(limit = 100) {
      const raw = await kv.lrange('calls:outcomes', 0, limit - 1);
      return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

export async function getCallsInitiated(limit = 100) {
      const raw = await kv.lrange('calls:log', 0, limit - 1);
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
      const [total, replies, unsubscribed, smsTotal, smsReplies, callsMade, callsAnswered, followupSms] = await Promise.all([
              kv.get('stats:total_sent'),
              kv.get('stats:replies'),
              kv.get('stats:unsubscribed'),
              kv.get('stats:sms_total_sent'),
              kv.get('stats:sms_replies'),
              kv.get('stats:calls_made'),
              kv.get('stats:calls_answered'),
              kv.get('stats:followup_sms')
            ]);
      	const today = mtDateStr();
      const [todayEmail, todaySms] = await Promise.all([
              kv.get(`stats:daily:${today}`),
              kv.get(`stats:sms_daily:${today}`)
            ]);
      const days = [];
      for (let i = 6; i >= 0; i--) {
                                      const key = mtDateStr(-i);
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
              totalCallsMade: parseInt(callsMade || 0),
              totalCallsAnswered: parseInt(callsAnswered || 0),
              totalFollowupSms: parseInt(followupSms || 0),
              dailyChart: days
      };
}


export async function trackEmailOpen(id) {
        if (!id) return;
        await kv.hincrby('email:opens:count', id, 1);
        const existing = await kv.hget('email:opens:first', id);
        if (!existing) await kv.hset('email:opens:first', { [id]: Date.now() });
        await kv.hset('email:opens:last', { [id]: Date.now() });
}

export async function trackEmailClick(id, url) {
        if (!id) return;
        await kv.hincrby('email:clicks:count', id, 1);
        await kv.hset('email:clicks:last', { [id]: Date.now() });
        if (url) await kv.hset('email:clicks:url', { [id]: url });
}

export async function getEmailEngagement() {
        const [opens, clicks, opensFirst, opensLast, clicksLast] = await Promise.all([
                  kv.hgetall('email:opens:count'),
                  kv.hgetall('email:clicks:count'),
                  kv.hgetall('email:opens:first'),
                  kv.hgetall('email:opens:last'),
                  kv.hgetall('email:clicks:last')
                ]);
        return {
                  opens: opens || {},
                  clicks: clicks || {},
                  opensFirst: opensFirst || {},
                  opensLast: opensLast || {},
                  clicksLast: clicksLast || {}
        };
}
