import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

/** 未納 (Minou): calculated – students who have schedule events this month but no payment for that month */
router.get('/unpaid', async (req, res) => {
  try {
    const monthParam = req.query.month;
    const now = new Date();
    const yyyyMm = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await query(
      `SELECT DISTINCT s.id, s.name, s.name_kanji, s.email, s.phone, s.phone_secondary, s.same_day_cancel, s.status, s.payment, s.group_type, s.group_size, s.is_child
       FROM students s
       INNER JOIN monthly_schedule m
         ON TRIM(m.student_name) = TRIM(s.name)
         AND to_char(m.date, 'YYYY-MM') = $1
         AND (m.status IS NULL OR m.status <> 'cancelled')
       WHERE NOT EXISTS (
         SELECT 1 FROM payments p
         WHERE p.student_id = s.id AND p.month = $1
       )
       ORDER BY s.name`,
      [yyyyMm]
    );
    const students = result.rows.map((r) => ({
      ID: r.id,
      Name: r.name,
      漢字: r.name_kanji,
      Email: r.email,
      Phone: r.phone,
      phone: r.phone_secondary,
      当日: r.same_day_cancel,
      Status: r.status,
      Payment: r.payment,
      Group: r.group_type,
      人数: r.group_size,
      子: r.is_child ? '子' : '',
    }));
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 未定 (Mitei): Active students with no scheduled lessons this month */
router.get('/unscheduled-lessons', async (req, res) => {
  try {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await query(
      `SELECT s.id, s.name, s.name_kanji, s.email, s.phone, s.phone_secondary, s.same_day_cancel, s.status, s.payment, s.group_type, s.group_size, s.is_child
       FROM students s
       WHERE s.status = 'Active'
       AND NOT EXISTS (
         SELECT 1 FROM monthly_schedule m
         WHERE TRIM(m.student_name) = TRIM(s.name)
         AND to_char(m.date, 'YYYY-MM') = $1
         AND (m.status IS NULL OR m.status NOT IN ('cancelled'))
       )
       ORDER BY s.name`,
      [thisMonth]
    );
    const students = result.rows.map((r) => ({
      ID: r.id,
      Name: r.name,
      漢字: r.name_kanji,
      Email: r.email,
      Phone: r.phone,
      phone: r.phone_secondary,
      当日: r.same_day_cancel,
      Status: r.status,
      Payment: r.payment,
      Group: r.group_type,
      人数: r.group_size,
      子: r.is_child ? '子' : '',
    }));
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Build array of YYYY-MM from start to end (inclusive). */
function monthRange(fromYYYYMM, toYYYYMM) {
  const out = [];
  const [yFrom, mFrom] = fromYYYYMM.split('-').map(Number);
  const [yTo, mTo] = toYYYYMM.split('-').map(Number);
  let y = yFrom;
  let m = mFrom;
  while (y < yTo || (y === yTo && m <= mTo)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** GET /metrics – time-series for dashboard charts. Query params: from (YYYY-MM), to (YYYY-MM). Default: last 12 months. */
router.get('/metrics', async (req, res) => {
  try {
    const now = new Date();
    const toParam = req.query.to;
    const fromParam = req.query.from;
    const to = (toParam && /^\d{4}-\d{2}$/.test(toParam))
      ? toParam
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const toDate = new Date(to + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const toEnd = toDate.toISOString().slice(0, 10);
    let from;
    if (fromParam && /^\d{4}-\d{2}$/.test(fromParam)) {
      from = fromParam;
    } else {
      const fromDate = new Date(to + '-01');
      fromDate.setMonth(fromDate.getMonth() - 11);
      from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
    }
    const fromStart = from + '-01';
    const months = monthRange(from, to);

    const [regularResult, demoResult, joinedResult] = await Promise.all([
      query(
        `SELECT to_char(date, 'YYYY-MM') as month, COUNT(DISTINCT student_name)::int as count
         FROM monthly_schedule
         WHERE lesson_kind = 'regular' AND (status IS NULL OR status <> 'cancelled') AND date IS NOT NULL
         AND date >= $1::date AND date < $2::date
         GROUP BY to_char(date, 'YYYY-MM')`,
        [fromStart, toEnd]
      ),
      query(
        `SELECT to_char(date, 'YYYY-MM') as month, COUNT(*)::int as count
         FROM monthly_schedule
         WHERE lesson_kind = 'demo' AND (status IS NULL OR status <> 'cancelled') AND date IS NOT NULL
         AND date >= $1::date AND date < $2::date
         GROUP BY to_char(date, 'YYYY-MM')`,
        [fromStart, toEnd]
      ),
      query(
        `WITH first_payment AS (
           SELECT student_id, MIN(month) AS first_month
           FROM payments
           WHERE month IS NOT NULL AND month ~ '^\\d{4}-\\d{2}$'
           GROUP BY student_id
         )
         SELECT first_month AS month, COUNT(*)::int AS count
         FROM first_payment
         WHERE first_month >= $1 AND first_month <= $2
         GROUP BY first_month`,
        [from, to]
      ),
    ]);

    const byMonth = (rows, key) => {
      const map = {};
      for (const r of (rows || [])) map[r.month] = r.count;
      return months.map((month) => ({ month, count: map[month] ?? 0 }));
    };

    res.json({
      regularStudentsPerMonth: byMonth(regularResult.rows, 'count'),
      demoLessonsPerMonth: byMonth(demoResult.rows, 'count'),
      studentsJoinedPerMonth: byMonth(joinedResult.rows, 'count'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /today-lessons - today's lesson list in Asia/Tokyo timezone. */
router.get('/today-lessons', async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         m.event_id,
         m.student_name,
         COALESCE(m.student_id, sm.id) AS student_id,
         sg.group_type,
         m.status,
         COALESCE(
           NULLIF(lower(trim(m.lesson_mode)), ''),
           CASE
             WHEN lower(COALESCE(m.title, '')) ~ '\\bcafe\\b|カフェ' THEN 'cafe'
             WHEN lower(COALESCE(m.title, '')) ~ '\\bonline\\b|オンライン|\\bzoom\\b|ズーム|\\bmeet\\b' THEN 'online'
             ELSE 'unknown'
           END
         ) AS lesson_mode,
         lower(trim(COALESCE(m.lesson_kind, ''))) AS lesson_kind,
         m.date::text AS date,
         CASE WHEN m.start IS NOT NULL THEN to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') ELSE NULL END AS start_time,
         EXISTS (
           SELECT 1
           FROM payments p
           WHERE p.student_id = COALESCE(m.student_id, sm.id)
             AND (
               p.month = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM')
               OR p.month = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-FMMM')
               OR (
                 p.year = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY')
                 AND lower(trim(COALESCE(p.month, ''))) IN (
                   lower(to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'FMMonth')),
                   lower(to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'Mon'))
                 )
               )
               OR (
                 p.year = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY')
                 AND p.month = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM')
               )
               OR (
                 p.date IS NOT NULL
                 AND to_char(p.date, 'YYYY-MM') = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM')
               )
             )
         ) AS paid_this_month,
         NOT EXISTS (
           SELECT 1 FROM monthly_schedule m2
           WHERE m2.student_name = m.student_name
             AND to_char(m2.date, 'YYYY-MM') = to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM')
             AND (m2.status IS NULL OR lower(trim(m2.status)) <> 'cancelled')
             AND (m2.date > m.date OR (m2.date = m.date AND m2.start > m.start))
         ) AS is_last_lesson_of_month
       FROM monthly_schedule m
       LEFT JOIN LATERAL (
         SELECT s.id
         FROM students s
         WHERE REGEXP_REPLACE(TRIM(s.name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g')
         ORDER BY s.id
         LIMIT 1
       ) sm ON m.student_id IS NULL
       LEFT JOIN students sg ON sg.id = COALESCE(m.student_id, sm.id)
       WHERE m.date = (now() AT TIME ZONE 'Asia/Tokyo')::date
         AND (m.status IS NULL OR lower(trim(m.status)) <> 'cancelled')
       ORDER BY m.start NULLS LAST, m.student_name`
    );

    const dateResult = await query(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS today`
    );

    res.json({
      date: dateResult.rows[0]?.today || null,
      lessons: result.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

    const [studentsResult, paymentsResult, statsResult] = await Promise.all([
      query('SELECT COUNT(*) as count FROM students'),
      query(
        `SELECT COALESCE(SUM(total), 0) as total FROM payments WHERE month = $1 OR (year = $2 AND month = $1)`,
        [thisMonth, String(now.getFullYear())]
      ),
      query('SELECT * FROM stats WHERE month = $1 OR month = $2', [thisMonth, lastMonth]),
    ]);

    const studentCount = parseInt(studentsResult.rows[0]?.count || 0, 10);
    const feesThisMonth = parseFloat(paymentsResult.rows[0]?.total || 0);
    const statsByMonth = {};
    for (const r of statsResult.rows) {
      statsByMonth[r.month] = { lessons: r.lessons, students: r.students };
    }

    res.json({
      studentCount,
      feesThisMonth,
      lessonsThisMonth: statsByMonth[thisMonth]?.lessons ?? 0,
      studentsThisMonth: statsByMonth[thisMonth]?.students ?? 0,
      lessonsLastMonth: statsByMonth[lastMonth]?.lessons ?? 0,
      studentsLastMonth: statsByMonth[lastMonth]?.students ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
