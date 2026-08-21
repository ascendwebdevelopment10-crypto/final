import { likelyHumanOpen } from './outreach-analytics.js';
import { replyAngle } from './outreach-targeting.js';

export const FOLLOWUP_MIN_AGE_MS = 4 * 60 * 60 * 1000;
export const FOLLOWUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const FINAL_FOLLOWUP_DELAY_MS = 48 * 60 * 60 * 1000;

function companyName(entry) {
  return String(entry?.contactName || 'your business').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
}

export function followupIntent(entry, automatedOpenIds) {
  if (entry?.confirmedVisit) return 'confirmed_visit';
  if (likelyHumanOpen(entry, automatedOpenIds)) return 'human_open';
  return null;
}

export function followupMessage(entry, sequence = 2) {
  const company = companyName(entry);
  const angle = replyAngle(entry?.industry);
  if (Number(sequence) >= 3) {
    return {
      subject: `One last note about Nitro for ${company}`,
      body: `Hi ${company} team,\n\nOne last note about Nitro. It puts website building, social content and scheduling, tracked outreach, and visitor analytics in one workspace.\n\nFor ${company}, that can make it easier to ${angle} without paying for or switching between separate tools. The free plan does not require a card.\n\nnitrooutreach.com\n\nThis is my last follow-up. If it is not useful right now, no action is needed.`,
    };
  }
  return {
    subject: `How Nitro could help ${company}`,
    body: `Hi ${company} team,\n\nYou recently took a look at Nitro, so here is the simplest explanation of what it does. Nitro puts website building, social content and scheduling, tracked outreach, and visitor analytics in one workspace.\n\nFor ${company}, that can make it easier to ${angle} without paying for or switching between separate tools. The free plan does not require a card.\n\nnitrooutreach.com\n\nIf it is not useful for the business right now, no problem.`,
  };
}

export function chooseFollowupCandidates(entries, automatedOpenIds, now = Date.now()) {
  const originals = (entries || []).filter(entry => entry?.id && entry?.to && !entry.followUpOf && Number(entry.sequence || 1) === 1);
  const followupsByOriginal = new Map();
  for (const entry of entries || []) {
    if (!entry?.followUpOf) continue;
    const list = followupsByOriginal.get(entry.followUpOf) || [];
    list.push(entry);
    followupsByOriginal.set(entry.followUpOf, list);
  }
  const candidates = [];
  for (const entry of originals) {
    if (entry.replied || entry.unsubscribed || ['bounced', 'failed', 'complained', 'suppressed'].includes(String(entry.status || '').toLowerCase())) continue;
    const prior = (followupsByOriginal.get(entry.id) || []).sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0));
    if (prior.some(item => Number(item.sequence || 0) >= 3)) continue;
    const second = prior.find(item => Number(item.sequence || 0) === 2);
    if (second) {
      const age = now - Number(second.timestamp || 0);
      if (age >= FINAL_FOLLOWUP_DELAY_MS && age <= FOLLOWUP_MAX_AGE_MS) candidates.push({ entry, sequence: 3, intent: 'final', signalAt: Number(second.timestamp || 0), priority: 1 });
      continue;
    }
    const intent = followupIntent(entry, automatedOpenIds);
    if (!intent) continue;
    const signalAt = Number(intent === 'confirmed_visit' ? entry.firstConfirmedAt : entry.lastOpenedAt || entry.firstOpenedAt || 0);
    const age = now - signalAt;
    if (!signalAt || age < FOLLOWUP_MIN_AGE_MS || age > FOLLOWUP_MAX_AGE_MS) continue;
    candidates.push({ entry, sequence: 2, intent, signalAt, priority: intent === 'confirmed_visit' ? 3 : 2 });
  }
  return candidates.sort((a, b) => b.priority - a.priority || b.signalAt - a.signalAt);
}
