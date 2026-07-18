const API_BASE = 'https://api.hunter.io/v2';

export const HUNTER_SEQUENCE_ID = process.env.HUNTER_SEQUENCE_ID || '862213';

export function hunterConfigured() {
  return Boolean(process.env.HUNTER_API_KEY && HUNTER_SEQUENCE_ID);
}

async function hunterRequest(path, { method = 'GET', body } = {}) {
  if (!process.env.HUNTER_API_KEY) throw new Error('HUNTER_API_KEY is not configured');
  const response = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.HUNTER_API_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.errors?.[0]?.details || payload?.errors?.[0]?.code || payload?.message || response.statusText;
    throw new Error('Hunter API ' + response.status + ': ' + details);
  }
  return payload?.data ?? payload;
}

function sequenceState(sequence) {
  return String(sequence?.status || sequence?.state || '').toLowerCase();
}

export async function getHunterSequence() {
  return hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID));
}

export async function listHunterFollowups() {
  const result = await hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID) + '/follow-ups');
  return Array.isArray(result) ? result : (result?.follow_ups || result?.followups || []);
}

export async function addHunterRecipients(emails) {
  const unique = [...new Set((emails || []).map(email => String(email).trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return { submitted: 0 };
  let submitted = 0;
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    await hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID) + '/recipients', {
      method: 'POST',
      body: { emails: batch }
    });
    submitted += batch.length;
  }
  return { submitted };
}

const COPY = [
  {
    subject: 'quick question about your website',
    wait_days: 0,
    body: `Hi,

I took a quick look at your business online and noticed a few opportunities that may be costing you calls or bookings.

I run Ascend Web Development. We help local service businesses turn more website visitors into real customers.

Would it be useful if I sent over a short, no-cost website audit with the three changes I would prioritize?

Ty Smith
Owner, Ascend Web Development`
  },
  {
    subject: 'Re: quick question about your website',
    wait_days: 3,
    body: `Hi,

Just following up in case my note got buried. I am happy to put together the website audit at no cost—no meeting or commitment required.

If you want it, just reply “audit” and I will send it over.

Ty`
  },
  {
    subject: 'one last website idea',
    wait_days: 5,
    body: `Hi,

Last note from me. If improving the number of calls or bookings your website produces is a priority this year, I can send the short audit I mentioned.

If the timing is not right, no worries at all.

Ty Smith
Ascend Web Development`
  }
];

let configuredThisInstance = false;

export async function ensureHunterSequenceConfigured() {
  const sequence = await getHunterSequence();
  const state = sequenceState(sequence);
  const active = ['active', 'running', 'started'].includes(state) || sequence?.active === true;
  if (configuredThisInstance || active) {
    configuredThisInstance = true;
    return { sequence, configured: false, active };
  }

  await hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID), {
    method: 'PUT',
    body: {
      name: 'Ascend Business Outreach',
      add_unsubscribe_link: true,
      tracked: true,
      schedule_time_start: '09:00',
      schedule_time_end: '16:30',
      schedule_days: [1, 2, 3, 4, 5]
    }
  });

  const existing = (await listHunterFollowups()).sort((a, b) => Number(a.step || 0) - Number(b.step || 0));
  for (let i = 0; i < COPY.length; i++) {
    const template = COPY[i];
    const body = {
      subject: template.subject,
      body: template.body,
      wait_days: template.wait_days,
      message_format: 'text'
    };
    if (existing[i]?.id) {
      await hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID) + '/follow-ups/' + encodeURIComponent(existing[i].id), {
        method: 'PUT',
        body
      });
    } else {
      await hunterRequest('/sequences/' + encodeURIComponent(HUNTER_SEQUENCE_ID) + '/follow-ups', {
        method: 'POST',
        body: { ...body, step: i }
      });
    }
  }

  configuredThisInstance = true;
  return { sequence: await getHunterSequence(), configured: true, active: false };
}
