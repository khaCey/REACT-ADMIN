/**
 * Demo lesson / signed-up tracker helpers.
 */
import { query } from '../db/index.js';

function normalizeDemoDate(val) {
  const s = String(val || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeTeacherName(val) {
  if (val == null) return null;
  const t = String(val).trim();
  return t || null;
}

/**
 * Upsert a tracker row from a schedule demo lesson (book or poll).
 * Does not overwrite signed_up when already true.
 * @returns {Promise<number|null>} event id
 */
export async function upsertDemoLessonEvent({
  studentId,
  demoDate,
  teacherName = null,
  sourceEventId = null,
}) {
  const sid = Number(studentId);
  const date = normalizeDemoDate(demoDate);
  if (!Number.isFinite(sid) || sid <= 0 || !date) return null;
  const teacher = normalizeTeacherName(teacherName);
  const eid = sourceEventId != null ? String(sourceEventId).trim() || null : null;

  if (eid) {
    const bySource = await query(
      `SELECT id FROM demo_lesson_events WHERE source_event_id = $1 LIMIT 1`,
      [eid]
    );
    if (bySource.rows[0]) {
      await query(
        `UPDATE demo_lesson_events SET
           student_id = $2,
           demo_date = $3::date,
           teacher_name = COALESCE($4, teacher_name),
           updated_at = NOW()
         WHERE id = $1`,
        [bySource.rows[0].id, sid, date, teacher]
      );
      return Number(bySource.rows[0].id);
    }
  }

  const result = await query(
    `INSERT INTO demo_lesson_events (student_id, teacher_name, demo_date, source_event_id)
     VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (student_id, demo_date) DO UPDATE SET
       teacher_name = COALESCE(EXCLUDED.teacher_name, demo_lesson_events.teacher_name),
       source_event_id = COALESCE(demo_lesson_events.source_event_id, EXCLUDED.source_event_id),
       updated_at = NOW()
     RETURNING id`,
    [sid, teacher, date, eid]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

/** Mark all tracker rows for a student as signed up (DEMO → Active). */
export async function markDemoEventsSignedUpForStudent(studentId) {
  const sid = Number(studentId);
  if (!Number.isFinite(sid) || sid <= 0) return 0;
  const result = await query(
    `UPDATE demo_lesson_events
        SET signed_up = TRUE, updated_at = NOW()
      WHERE student_id = $1 AND signed_up = FALSE`,
    [sid]
  );
  return result.rowCount || 0;
}

/**
 * Import past demo lessons from monthly_schedule (idempotent).
 * @returns {Promise<{ imported: number, skipped: number }>}
 */
export async function importPastDemoLessonsFromSchedule() {
  const result = await query(
    `SELECT DISTINCT ON (m.event_id, m.student_id)
        m.event_id,
        m.student_id,
        m.date,
        m.teacher_name,
        m.status
       FROM monthly_schedule m
      WHERE LOWER(TRIM(COALESCE(m.lesson_kind, ''))) = 'demo'
        AND m.student_id IS NOT NULL
        AND LOWER(TRIM(COALESCE(m.status, ''))) NOT IN ('cancelled', 'canceled')
      ORDER BY m.event_id, m.student_id, m.start DESC NULLS LAST`
  );
  let imported = 0;
  let skipped = 0;
  for (const row of result.rows || []) {
    const date =
      row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : normalizeDemoDate(row.date);
    if (!date) {
      skipped += 1;
      continue;
    }
    const before = await query(
      `SELECT id FROM demo_lesson_events
        WHERE source_event_id = $1
           OR (student_id = $2 AND demo_date = $3::date)
        LIMIT 1`,
      [String(row.event_id || '').trim() || null, Number(row.student_id), date]
    );
    if (before.rows[0]) {
      skipped += 1;
      // Still refresh teacher / source link without touching signed_up
      await upsertDemoLessonEvent({
        studentId: row.student_id,
        demoDate: date,
        teacherName: row.teacher_name,
        sourceEventId: row.event_id,
      });
      continue;
    }
    const id = await upsertDemoLessonEvent({
      studentId: row.student_id,
      demoDate: date,
      teacherName: row.teacher_name,
      sourceEventId: row.event_id,
    });
    if (id) imported += 1;
    else skipped += 1;
  }
  return { imported, skipped, scanned: (result.rows || []).length };
}

export function mapDemoLessonEventRow(r, student = null) {
  return {
    id: r.id,
    student_id: r.student_id,
    student_name: student?.name ?? r.student_name ?? null,
    student_kanji: student?.name_kanji ?? r.student_kanji ?? null,
    student_status: student?.status ?? r.student_status ?? null,
    teacher_name: r.teacher_name,
    demo_date:
      r.demo_date instanceof Date
        ? r.demo_date.toISOString().slice(0, 10)
        : String(r.demo_date || '').slice(0, 10),
    signed_up: !!r.signed_up,
    source_event_id: r.source_event_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
