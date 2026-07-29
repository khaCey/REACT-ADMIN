/** SQL / status constants shared by booking services and schedule routes. */

export const SQL_NOT_STAFF_BREAK = `(m.lesson_kind IS NULL OR m.lesson_kind <> 'staff_break')`;

/** Reserved placeholders do not block student slot overlap (same as staff book). */
export const SQL_BLOCKS_STUDENT_SLOT_OVERLAP = `(m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled', 'reserved'))`;

export const LOCAL_BOOKING_EVENT_ID_PREFIX = 'local-booking-';

export const CALENDAR_SYNC_STATUS_PENDING = 'pending';
export const CALENDAR_SYNC_STATUS_SYNCED = 'synced';
export const CALENDAR_SYNC_STATUS_FAILED = 'failed';
