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
