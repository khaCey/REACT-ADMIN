/**
 * Monthly lesson quota counters must ignore demo appointments and other
 * non-regular schedule entries even though those entries remain visible.
 */
export function countsTowardsRegularLessonPack(lesson) {
  const kind = String(lesson?.lessonKind ?? lesson?.lesson_kind ?? 'regular').trim().toLowerCase();
  if (kind === 'demo' || kind === 'staff_break') return false;
  const status = String(lesson?.status || '').trim().toLowerCase();
  if (status === 'unscheduled') return false;
  if (status === 'rescheduled') {
    return !!(lesson?.awaitingRescheduleDate ?? lesson?.awaiting_reschedule_date)
      && !lesson?.rescheduledTo && !lesson?.optimisticRescheduledTo;
  }
  // The original source slot is preserved for display when it is rescheduled,
  // but only the destination consumes a credit.
  return !lesson?.rescheduledTo && !lesson?.optimisticRescheduledTo;
}

export function countBookedRegularLessons(lessons) {
  return (lessons || []).filter(countsTowardsRegularLessonPack).length;
}

/** Quota accounting differs from slot availability: cancellation still uses a credit. */
export function lessonPackStatusSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `(COALESCE(LOWER(TRIM(${p}status)), '') NOT IN ('rescheduled', 'unscheduled')
    OR (LOWER(TRIM(${p}status)) = 'rescheduled' AND ${p}awaiting_reschedule_date IS TRUE))`;
}

export function stripCancelledTitleMarker(title) {
  return String(title || '').replace(/\s*(?:[·•-]\s*)?(?:\[Cancelled\]|Cancelled)\s*$/i, '').trim();
}

export function applyCancelledTitleMarker(title) {
  return `${stripCancelledTitleMarker(title)} · Cancelled`;
}

export function parseLessonPackTotal(title) {
  const match = stripCancelledTitleMarker(title).match(/\b\d+\s*\/\s*(\d+)(?:\s*[·•-]?\s*Moved\s+(?:from|to)\s+(?:\?{3}|\d{1,2}(?:st|nd|rd|th)))?\s*$/i);
  return match ? Number(match[1]) : 0;
}

/** Undo cancellation/date-pending status, retaining replacement provenance. */
export function restoreActiveLessonTitle(title) {
  return stripCancelledTitleMarker(title)
    .replace(/\s*(?:[·•-]\s*)?Moved\s+to\s+(?:\?{3}|\d{1,2}(?:st|nd|rd|th))\s*$/i, '')
    .replace(/\s*\[RESCHEDULED\]\s*$/i, '').trim();
}
