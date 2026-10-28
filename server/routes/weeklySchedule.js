import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { groupWeekLessons, weekRange } from '../../shared/weeklySchedule.js';

export function createWeeklyScheduleRouter(db = query) {
  const router = Router();
  router.get('/', requireAdmin, async (req, res) => {
    let week;
    try { week = weekRange(req.query.week_start); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const result = await db(
        `SELECT event_id, title, date, start, "end", student_id, student_name, status,
                is_kids_lesson, teacher_name, lesson_kind, awaiting_reschedule_date, calendar_sync_status
           FROM monthly_schedule
          WHERE COALESCE(lesson_kind, 'regular') <> 'staff_break'
            AND ((date >= $1::date AND date < $2::date)
              OR (start < $4::timestamptz AND COALESCE("end", start + INTERVAL '50 minutes') > $3::timestamptz))
          ORDER BY date, start NULLS LAST, event_id, group_sort_order NULLS LAST, student_name`,
        [week.start, week.end, week.start + 'T00:00:00+09:00', week.end + 'T00:00:00+09:00']
      );
      res.set('Cache-Control', 'no-store');
      res.json({ weekStart: week.start, weekEnd: week.end, days: week.days,
        timezone: 'Asia/Tokyo', lessons: groupWeekLessons(result.rows), fetchedAt: new Date().toISOString() });
    } catch (error) {
      console.error('[weekly-schedule] database read failed', error);
      res.status(500).json({ error: 'Unable to load the weekly schedule' });
    }
  });
  return router;
}
export default createWeeklyScheduleRouter();
