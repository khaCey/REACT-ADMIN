/**
 * Frozen HTTP contracts for staff booking APIs.
 * Changing these requires a coordinated admin client release.
 * @see docs/booking-api-audit.md
 */

/** Keys that GET /api/schedule/week must continue to return (subset required by BookLessonModal). */
export const WEEK_GRID_REQUIRED_KEYS = [
  'slots',
  'teachersBySlot',
  'slotTypes',
  'slotMix',
  'breakRuleBlocked',
  'staffBreakBySlot',
];

/** Optional keys when student_id / owner previews apply. */
export const WEEK_GRID_OPTIONAL_KEYS = [
  'studentBookedSlots',
  'ownerShamBlocked',
  'ownerCourseConflictBlocked',
];

/** POST /book success body fields used by the client. */
export const BOOK_SUCCESS_REQUIRED_KEYS = [
  'ok',
  'event_id',
  'calendar_sync_status',
  'date',
  'start',
  'end',
];
