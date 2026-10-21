/**
 * Resolve lesson status from the Calendar polling payload.
 * "Moved to" belongs to the inactive source; "Moved from" belongs to the
 * active replacement. GAS may report the replacement as rescheduled based on
 * its title, so correct that one false-positive without overriding cancellations.
 */
const VALID_STATUSES = new Set([
  'scheduled', 'cancelled', 'reserved', 'rescheduled', 'demo', 'unscheduled',
]);
const MOVED_TO_RE = /Moved\s+to\s+(\?{3}|\d{1,2}(?:st|nd|rd|th))/i;
const MOVED_FROM_RE = /Moved\s+from\s+(\?{3}|\d{1,2}(?:st|nd|rd|th))/i;
const LEGACY_RESCHEDULED_RE = /\[RESCHEDULED\]/i;

export function resolvePolledScheduleStatus(rawStatus, title) {
  const candidate = String(rawStatus || 'scheduled').trim().toLowerCase() || 'scheduled';
  const status = VALID_STATUSES.has(candidate) ? candidate : 'scheduled';
  const eventTitle = String(title || '');

  if (/(?:\[Cancelled\]|\bCancelled)\s*$/i.test(eventTitle)) return 'cancelled';

  // An original lesson remains inactive even if graphite was polled as cancelled.
  if (MOVED_TO_RE.test(eventTitle) || LEGACY_RESCHEDULED_RE.test(eventTitle)) {
    return 'rescheduled';
  }
  // "Moved from" identifies the active replacement, not a second cancelled slot.
  // Preserve explicit cancellation (and any other non-rescheduled status).
  if (MOVED_FROM_RE.test(eventTitle) && status === 'rescheduled') {
    return 'scheduled';
  }
  return status;
}
