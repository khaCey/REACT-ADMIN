/**
 * Monthly lesson quota counters must ignore demo appointments and other
 * non-regular schedule entries even though those entries remain visible.
 */
export function countsTowardsRegularLessonPack(lesson) {
  const kind = String(lesson?.lessonKind ?? lesson?.lesson_kind ?? 'regular').trim().toLowerCase();
  if (kind === 'demo' || kind === 'staff_break') return false;
  const status = String(lesson?.status || '').trim().toLowerCase();
  if (status === 'cancelled' || status === 'canceled' ||
      status === 'rescheduled' || status === 'unscheduled') return false;
  // The original source slot is preserved for display when it is rescheduled,
  // but only the destination consumes a credit.
  return !lesson?.rescheduledTo && !lesson?.optimisticRescheduledTo;
}

export function countBookedRegularLessons(lessons) {
  return (lessons || []).filter(countsTowardsRegularLessonPack).length;
}
