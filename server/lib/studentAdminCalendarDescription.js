/**
 * Machine-readable block appended to Google Calendar event descriptions by Student Admin ↔ GAS.
 * GAS must use the same marker (see Calendar API merge + MonthlyCache parsing).
 */
export const STUDENT_ADMIN_DESCRIPTION_BLOCK_START = '---student-admin---';

/**
 * Parse awaiting_reschedule_date from a calendar description (same rules as GAS).
 * @param {string|null|undefined} description
 * @returns {boolean|null} true / false if explicit; null if no block or key missing
 */
export function parseAwaitingRescheduleFromDescription(description) {
  const s = String(description || '');
  const idx = s.indexOf(STUDENT_ADMIN_DESCRIPTION_BLOCK_START);
  if (idx < 0) return null;
  const tail = s.slice(idx);
  const m = tail.match(/awaiting_reschedule_date\s*=\s*([01])/i);
  if (!m) return null;
  return m[1] === '1';
}
