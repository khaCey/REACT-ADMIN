/**
 * Teacher consecutive teaching-hour rule (JST): at most 5 consecutive clock hours
 * with a "teaching" lesson per teacher per calendar day; a gap hour resets the run.
 * Rows with lesson_kind = staff_break do not count as teaching (intentional break / gap).
 * Only lesson_kind regular (or null/empty, treated as regular) count toward streaks;
 * other kinds (e.g. demo) still occupy capacity but do not extend the streak.
 */

import { getJstMinutesOfDay } from './timezone.js';

const MAX_CONSECUTIVE_TEACHING_HOURS = 5;

/**
 * @param {Date} utcDate
 * @returns {string} "HH:00" in JST (start-hour bucket, aligned with GET /week).
 */
export function jstHourLabelFromUtc(utcDate) {
  const mod = getJstMinutesOfDay(utcDate);
  const h = Math.floor(mod / 60);
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * @param {string|undefined|null} lessonKind
 */
export function isStaffBreakKind(lessonKind) {
  return String(lessonKind || '').trim() === 'staff_break';
}

/**
 * Counts toward consecutive-teaching streak (regular only for v1).
 * @param {string|undefined|null} lessonKind
 */
export function countsTowardTeachingStreak(lessonKind) {
  if (isStaffBreakKind(lessonKind)) return false;
  const k = String(lessonKind == null ? 'regular' : lessonKind).trim();
  return k === '' || k === 'regular';
}

/**
 * @typedef {{ time_jst?: string, teacher_name?: string|null, lesson_kind?: string|null }} ScheduleRowLike
 */

/**
 * @param {string|undefined|null} teacherName
 * @param {string|null} singleTeacherOnDay - if exactly one teacher has a shift that day, attribute NULL rows to them
 * @returns {string|null}
 */
export function attributeRowToTeacher(teacherName, singleTeacherOnDay) {
  const tn = teacherName != null ? String(teacherName).trim() : '';
  if (tn) return tn;
  return singleTeacherOnDay || null;
}

/**
 * Build map: teacherName -> Set of JST hour labels "HH:00" where they have a counting lesson.
 * @param {ScheduleRowLike[]} rows - one calendar day, pre-filtered (not cancelled, exclusions applied)
 * @param {string[]} distinctTeachersOnDay - all teacher_name values with a shift that day
 * @returns {Map<string, Set<string>>}
 */
export function buildTeachingHoursByTeacher(rows, distinctTeachersOnDay) {
  const single =
    distinctTeachersOnDay && distinctTeachersOnDay.length === 1
      ? distinctTeachersOnDay[0]
      : null;
  /** @type {Map<string, Set<string>>} */
  const map = new Map();

  for (const row of rows) {
    if (!countsTowardTeachingStreak(row.lesson_kind)) continue;
    const teacher = attributeRowToTeacher(row.teacher_name, single);
    if (!teacher) continue;
    const timeStr = row.time_jst ? String(row.time_jst).trim().slice(0, 5) : '';
    if (!timeStr) continue;
    if (!map.has(teacher)) map.set(teacher, new Set());
    map.get(teacher).add(timeStr);
  }
  return map;
}

/**
 * Length of contiguous integer hour run containing `hourLabel`, given a set of "HH:00" strings.
 * @param {Set<string>|string[]} hourLabels
 * @param {string} hourLabel
 */
export function contiguousStreakLengthContainingHour(hourLabels, hourLabel) {
  const toH = (s) => parseInt(String(s).slice(0, 2), 10);
  const nums = new Set(
    [...hourLabels].map((x) => toH(x)).filter((n) => Number.isFinite(n))
  );
  const h = toH(hourLabel);
  if (!nums.has(h)) return 0;
  let l = h;
  while (nums.has(l - 1)) l -= 1;
  let r = h;
  while (nums.has(r + 1)) r += 1;
  return r - l + 1;
}

/**
 * Streak length for `teacher` if a regular lesson were added at `hourLabel`.
 * @param {Map<string, Set<string>>} teachingHoursByTeacher
 * @param {string} teacher
 * @param {string} hourLabel
 */
export function streakLengthAfterAddingHour(teachingHoursByTeacher, teacher, hourLabel) {
  const existing = teachingHoursByTeacher.get(teacher);
  const set = new Set(existing || []);
  set.add(hourLabel);
  return contiguousStreakLengthContainingHour(set, hourLabel);
}

/**
 * Teachers on shift for the slot who could take one more regular lesson at hourLabel without exceeding max streak.
 * @param {string[]} teachersOnShiftForSlot
 * @param {Map<string, Set<string>>} teachingHoursByTeacher
 * @param {string} hourLabel
 * @param {number} [maxStreak]
 * @returns {string[]}
 */
export function findAssignableTeachers(
  teachersOnShiftForSlot,
  teachingHoursByTeacher,
  hourLabel,
  maxStreak = MAX_CONSECUTIVE_TEACHING_HOURS
) {
  const out = [];
  for (const t of teachersOnShiftForSlot) {
    const len = streakLengthAfterAddingHour(teachingHoursByTeacher, t, hourLabel);
    if (len <= maxStreak) out.push(t);
  }
  return out;
}

/**
 * Deterministic pick: fewest teaching hours that day (before the new lesson), then lexicographic name.
 * @param {string[]} assignableTeachers
 * @param {Map<string, Set<string>>} teachingHoursByTeacher
 * @returns {string|null}
 */
export function pickTeacherForBooking(assignableTeachers, teachingHoursByTeacher) {
  if (!assignableTeachers.length) return null;
  let best = assignableTeachers[0];
  let bestCount = (teachingHoursByTeacher.get(best)?.size) || 0;
  for (let i = 1; i < assignableTeachers.length; i += 1) {
    const t = assignableTeachers[i];
    const c = (teachingHoursByTeacher.get(t)?.size) || 0;
    if (c < bestCount || (c === bestCount && t < best)) {
      best = t;
      bestCount = c;
    }
  }
  return best;
}

export { MAX_CONSECUTIVE_TEACHING_HOURS };
