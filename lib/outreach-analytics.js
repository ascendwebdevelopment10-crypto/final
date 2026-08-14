const FAST_OPEN_MS = 90 * 1000;
const BURST_WINDOW_MS = 2 * 60 * 1000;
const BURST_MIN_EMAILS = 4;
const DISTINCT_LATER_OPEN_MS = 3 * 60 * 1000;

function hasHumanSignal(entry) {
  return !!(entry?.replied || entry?.confirmedVisit || Number(entry?.confirmedVisitCount || 0) > 0);
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

// A tracking pixel is not proof of a human open. This intentionally uses a
// conservative confidence model: known automated requests, immediate loads,
// and coordinated multi-recipient bursts are removed unless a later on-site
// engagement or reply proves that a person was involved.
//
// Important: an email is not permanently poisoned just because a scanner was
// the first client to touch its pixel. If a later, distinct open happens well
// after the scanner window and there are more total opens than known automated
// opens, that later activity remains eligible to count as a likely-human open.
export function automatedOpenIds(entries, options = {}) {
  const fastOpenMs = Number(options.fastOpenMs || FAST_OPEN_MS);
  const burstWindowMs = Number(options.burstWindowMs || BURST_WINDOW_MS);
  const burstMinEmails = Number(options.burstMinEmails || BURST_MIN_EMAILS);
  const distinctLaterOpenMs = Number(options.distinctLaterOpenMs || DISTINCT_LATER_OPEN_MS);
  const automated = new Set();
  const opened = [];

  for (const entry of entries || []) {
    if (!entry?.id || !entry?.opened || hasHumanSignal(entry)) continue;
    const sentAt = numeric(entry.timestamp);
    const openedAt = numeric(entry.firstOpenedAt);
    const lastOpenedAt = numeric(entry.lastOpenedAt) || openedAt;
    const openCount = numeric(entry.openCount);
    const knownAutomatedOpenCount = numeric(entry.knownAutomatedOpenCount);
    const hasNonAutomatedRequest = openCount > knownAutomatedOpenCount;
    const hasDistinctLaterOpen = hasNonAutomatedRequest
      && sentAt > 0
      && lastOpenedAt > sentAt + Math.max(fastOpenMs, distinctLaterOpenMs)
      && lastOpenedAt - openedAt >= distinctLaterOpenMs;

    // Only classify the whole message as known automation when every recorded
    // open request was identified as automated. A scanner followed by a later
    // browser open should not be hidden forever.
    if (knownAutomatedOpenCount > 0 && !hasNonAutomatedRequest) automated.add(entry.id);

    // Immediate pixel loads are highly suspicious, but a clearly later open is
    // allowed to recover the message into the likely-human bucket.
    if (sentAt > 0 && openedAt >= sentAt && openedAt - sentAt <= fastOpenMs && !hasDistinctLaterOpen) {
      automated.add(entry.id);
    }

    if (openedAt > 0 && !hasDistinctLaterOpen) opened.push({ id: entry.id, openedAt });
  }

  opened.sort((a, b) => a.openedAt - b.openedAt);
  let start = 0;
  for (let end = 0; end < opened.length; end += 1) {
    while (opened[end].openedAt - opened[start].openedAt > burstWindowMs) start += 1;
    if (end - start + 1 >= burstMinEmails) {
      for (let index = start; index <= end; index += 1) automated.add(opened[index].id);
    }
  }
  return automated;
}

export function likelyHumanOpen(entry, automatedIds) {
  if (!entry?.opened) return false;
  if (hasHumanSignal(entry)) return true;
  return !automatedIds?.has(entry.id);
}
