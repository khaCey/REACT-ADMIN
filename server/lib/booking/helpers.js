/**
 * Shared booking helpers (pure + small DB lookups).
 * Used by staff schedule routes and booking services.
 */
import { randomUUID } from 'crypto';
import { query } from '../../db/index.js';
import {
  LOCAL_BOOKING_EVENT_ID_PREFIX,
  CALENDAR_SYNC_STATUS_SYNCED,
} from './constants.js';

export function isOwnerCoursePayment(payment) {
  return String(payment || '').toLowerCase().includes('owner');
}

export function clampBookingDurationMinutes(raw) {
  return Math.min(120, Math.max(30, Number(raw) || 50));
}

export function normalizeTeacherNameForOwner(s) {
  return String(s || '').trim().toLowerCase();
}

/** Staff id from OWNER_COURSE_STAFF_ID; product rule: owner's course tied to Sham. */
export async function resolveOwnerCourseTeacherName() {
  return 'Sham';
}

export function deriveLessonKindFromStudent(student) {
  const status = String(student?.status || '').trim().toUpperCase();
  if (status === 'DEMO') return 'demo';
  const payment = String(student?.payment || '').toLowerCase();
  if (payment.includes('owner')) return 'owner';
  return 'regular';
}

export function normalizeCalendarSyncStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  return v || CALENDAR_SYNC_STATUS_SYNCED;
}

export function buildLocalBookingEventId() {
  return `${LOCAL_BOOKING_EVENT_ID_PREFIX}${randomUUID()}`;
}

export function buildCalendarSyncKey() {
  return `booking-sync-${randomUUID()}`;
}

export function buildMonthlyEventId(rawEventId, lessonDate, startTs) {
  const raw = String(rawEventId || '').trim();
  const date = String(lessonDate || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return raw;
  const start = startTs ? new Date(startTs) : null;
  if (!start || Number.isNaN(start.getTime())) return `${raw}_${date}`;
  const timeSuffix = start.toISOString().slice(11, 19).replace(/:/g, '-');
  return `${raw}_${date}_${timeSuffix}`;
}

export function lessonModeToLocationLabel(lessonMode) {
  return String(lessonMode || '').trim().toLowerCase() === 'online' ? 'Online' : 'Cafe';
}

export function locationLabelToLessonMode(locationLabel) {
  return String(locationLabel || '').trim().toLowerCase() === 'online' ? 'online' : 'cafe';
}

export function normalizePersonName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function parseClock5(val) {
  const s = String(val || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}

export function normalizeTeacherNameKey(s) {
  return String(s || '').trim().toLowerCase();
}

export function dateWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : d.getUTCDay();
}

export function hourInHalfOpenRange(hourLabel, startTime, endTime) {
  return hourLabel >= startTime && hourLabel < endTime;
}

export async function getOrderedGroupMembers(groupId, db = query) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return [];
  const result = await db(
    `SELECT s.id, s.name, s.status, s.payment, s.is_child, sgm.sort_order
       FROM student_group_members sgm
       INNER JOIN students s ON s.id = sgm.student_id
      WHERE sgm.group_id = $1
      ORDER BY sgm.sort_order ASC, s.id ASC`,
    [gid]
  );
  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    name: normalizePersonName(row.name),
    status: row.status,
    payment: row.payment,
    is_child: !!row.is_child,
    sort_order: parseInt(row.sort_order, 10) || 0,
  }));
}

export function parsePackTotalFromTitle(title) {
  const m = String(title || '').match(/(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) return 0;
  return Math.max(0, parseInt(m[2], 10) || 0);
}
