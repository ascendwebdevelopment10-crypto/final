const FAST_OPEN_MS = 90 * 1000;
const BURST_WINDOW_MS = 2 * 60 * 1000;
const BURST_MIN_EMAILS = 4;

function hasHumanSignal(entry) {
  return !!(entry?.replied || entry?.confirmedVisit || Number(entry?.confirmedVisitCount || 0) > 0);
}

// A tracking pixel is not proof of a human open. This intentionally uses a
// conservative confidence model: known automated requests, immediate loads,
// and coordinated multi-recipient bursts are removed unless a later on-site
// engagement or reply proves that a person was involved.
export function automatedOpenIds(entries, options = {}) {
  const fastOpenMs = Number(options.fastOpenMs || FAST_OPEN_MS);
  const burstWindowMs = Number(options.burstWindowMs || BURST_WINDOW_MS);
  const burstMinEmails = Number(options.burstMinEmails || BURST_MIN_EMAILS);
  const automated = new Set();
  const opened = [];

  for (const entry of entries || []) {
    if (!entry?.id || !entry?.opened || hasHumanSignal(entry)) continue;
    const sentAt = Number(entry.timestamp || 0);
    const openedAt = Number(entry.firstOpenedAt || 0);
    if (Number(entry.knownAutomatedOpenCount || 0) > 0) automated.add(entry.id);
    if (sentAt > 0 && openedAt >= sentAt && openedAt - sentAt <= fastOpenMs) automated.add(entry.id);
    if (openedAt > 0) opened.push({ id: entry.id, openedAt });
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
