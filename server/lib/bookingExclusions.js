/**
 * DB student ids blocked from POST /schedule/book (in-app booking).
 * Their monthly_schedule rows are also ignored for slot counts, slotMix, and capacity
 * in GET /week and POST /book so they do not block other students.
 * Keep in sync with client/src/config/booking.js STUDENT_IDS_EXCLUDED_FROM_BOOKING.
 */
export const BOOKING_DISABLED_STUDENT_IDS = new Set([362]);

/** int[] for SQL `= ANY($n::int[])` (empty array is valid). */
export function bookingDisabledStudentIdsArray() {
  return Array.from(BOOKING_DISABLED_STUDENT_IDS);
}
