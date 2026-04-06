/**
 * Students who cannot use in-app lesson booking.
 * Keyed by database student id from the student record / modal props — not from schedule/calendar rows
 * (those may omit `student_id`).
 * Keep in sync with server/lib/bookingExclusions.js BOOKING_DISABLED_STUDENT_IDS.
 * On the server, those students' monthly_schedule rows are omitted from GET /week counts
 * and from POST /book overlap/capacity checks (rows with null student_id are still counted).
 */
export const STUDENT_IDS_EXCLUDED_FROM_BOOKING = new Set([362])

/** @param {unknown} studentIdProp - e.g. StudentDetailsModal `studentId` from the list selection */
export function isStudentExcludedFromBooking(studentIdProp, student) {
  const fromProp = Number(studentIdProp)
  if (Number.isFinite(fromProp) && STUDENT_IDS_EXCLUDED_FROM_BOOKING.has(fromProp)) return true
  const fromRecord = Number(student?.ID ?? student?.id)
  if (Number.isFinite(fromRecord) && STUDENT_IDS_EXCLUDED_FROM_BOOKING.has(fromRecord)) return true
  return false
}

/** Matches server deriveLessonKindFromStudent: demo/trial → single-lesson booking, D/L titles. */
export function studentIsDemoOrTrial(student) {
  if (!student) return false
  const s = String(student.Status ?? student.status ?? '').toLowerCase()
  return s.includes('demo') || s.includes('trial')
}
