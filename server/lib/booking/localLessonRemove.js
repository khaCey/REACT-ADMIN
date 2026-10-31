import { pool } from '../../db/index.js';
import { logChange } from '../changeLog.js';

/** Database-only removal. This module deliberately has no Calendar/GAS dependencies. */
export function createLocalLessonRemoveHandler({ dbPool = pool, audit = logChange } = {}) {
  return async (req, res) => {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required' });
    const eventId = String(req.body?.eventId || '').trim();
    const studentId = Number(req.body?.studentId);
    if (!eventId || !Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ error: 'A lesson event ID and student ID are required.' });
    let client;
    try {
      client = await dbPool.connect();
      await client.query('BEGIN');
      const selected = await client.query(`SELECT m.* FROM monthly_schedule m
        WHERE m.event_id=$1 AND (m.student_id=$2 OR (
          m.student_id IS NULL
          AND LOWER(REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g')) = (
            SELECT LOWER(REGEXP_REPLACE(TRIM(s.name), '\\s+', ' ', 'g')) FROM students s WHERE s.id=$2
          )
          AND 1 = (SELECT COUNT(*) FROM students s2 WHERE
            LOWER(REGEXP_REPLACE(TRIM(s2.name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g')))
        )) FOR UPDATE OF m`, [eventId, studentId]);
      const rows = selected.rows;
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That student lesson was not found. Refresh the schedule.' }); }
      const slots = new Set(rows.map(r => `${String(r.date)}|${r.start ? new Date(r.start).toISOString() : ''}`));
      if (slots.size !== 1 || rows.some(r => (!r.date || !r.start) && !/^(local-booking-|optimistic-|pending-)/i.test(eventId))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This record does not identify one lesson occurrence. Nothing was removed.' });
      }
      for (const row of rows) {
        if (row.date && row.start) {
          const date = row.date instanceof Date ? new Date(row.date.getTime()+9*3600000).toISOString().slice(0,10) : String(row.date).slice(0,10);
          await client.query(`INSERT INTO schedule_slot_dismissals(student_name,lesson_date,start_time_utc) VALUES($1,$2::date,$3::timestamptz) ON CONFLICT(student_name,lesson_date,start_time_utc) DO NOTHING`, [String(row.student_name).trim().replace(/\s+/g,' '),date,new Date(row.start).toISOString()]);
        }
      }
      let removedRows = 0;
      for (const row of rows) {
        const deleted = await client.query('DELETE FROM monthly_schedule WHERE event_id=$1 AND student_name=$2', [eventId, row.student_name]);
        removedRows += deleted.rowCount || 0;
      }
      if (removedRows !== rows.length) throw new Error('Lesson changed during removal. No changes were saved.');
      for (const row of rows) await audit({ entityType:'monthly_schedule',entityKey:`${eventId}_${row.student_name}`,action:'delete_local',oldData:row,newData:{ calendar_unchanged:true, polling_dismissed:!!row.start } },req,client);
      await client.query('COMMIT');
      return res.json({ ok:true,localOnly:true,calendarChanged:false,removedRows,studentId,eventId });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      console.error('[remove-local-lesson]',error.message);
      return res.status(500).json({ error:'Could not remove the Admin record. No Calendar changes were made.' });
    } finally { client?.release(); }
  };
}
export const handleLocalLessonRemove = createLocalLessonRemoveHandler();
