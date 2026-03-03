import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
});

async function main() {
  const payments = await pool.query(
    'SELECT transaction_id, student_id, month, year, date FROM payments WHERE student_id = 546 ORDER BY month'
  );
  console.log('Payments for 546:', JSON.stringify(payments.rows, null, 2));

  const schedule = await pool.query(
    "SELECT event_id, student_name, date, start, status FROM monthly_schedule WHERE student_name = 'Mai Kondo' ORDER BY start"
  );
  console.log('Schedule for Mai Kondo:', JSON.stringify(schedule.rows, null, 2));

  const student = await pool.query('SELECT id, name FROM students WHERE id = 546');
  console.log('Student 546:', JSON.stringify(student.rows, null, 2));

  await pool.end();
}

main().catch(console.error);
