import { query } from '../db/index.js';
import { upsertBookingPaymentMirror } from './googleSheets.js';

export function parseBillingMonth(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('month must be YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new Error('month must be YYYY-MM');
  }
  return { billingMonth: text, year, month };
}

function normalizeTransactionIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function aggregateRowToMirrorRecord(row, billingMonth) {
  return {
    studentId: String(row.student_id),
    studentName: String(row.student_name || ''),
    billingMonth,
    status: Number(row.payment_count || 0) > 0 ? 'paid' : 'unpaid',
    transactionIds: normalizeTransactionIds(row.transaction_ids),
    amount: row.amount ?? 0,
    total: row.total ?? 0,
    paidAt: row.paid_at ? String(row.paid_at) : '',
    sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : '',
  };
}

async function getMonthAggregates({ year, month }) {
  const result = await query(
    `SELECT
       p.student_id,
       COALESCE(s.name, '') AS student_name,
       COUNT(*)::int AS payment_count,
       ARRAY_AGG(p.transaction_id ORDER BY p.created_at ASC, p.transaction_id ASC) AS transaction_ids,
       COALESCE(SUM(p.amount), 0) AS amount,
       COALESCE(SUM(p.total), 0) AS total,
       MAX(p.date) AS paid_at,
       MAX(p.created_at) AS source_updated_at
     FROM payments p
     LEFT JOIN students s ON s.id = p.student_id
     WHERE p.year = $1 AND p.month = $2
     GROUP BY p.student_id, s.name
     ORDER BY p.student_id ASC`,
    [year, month]
  );
  return result.rows || [];
}

async function getStudentMonthAggregate(studentId, year, month) {
  const result = await query(
    `SELECT
       s.id AS student_id,
       COALESCE(s.name, '') AS student_name,
       COUNT(p.transaction_id)::int AS payment_count,
       COALESCE(
         ARRAY_AGG(p.transaction_id ORDER BY p.created_at ASC, p.transaction_id ASC)
           FILTER (WHERE p.transaction_id IS NOT NULL),
         ARRAY[]::text[]
       ) AS transaction_ids,
       COALESCE(SUM(p.amount), 0) AS amount,
       COALESCE(SUM(p.total), 0) AS total,
       MAX(p.date) AS paid_at,
       MAX(p.created_at) AS source_updated_at
     FROM students s
     LEFT JOIN payments p
       ON p.student_id = s.id
      AND p.year = $2
      AND p.month = $3
     WHERE s.id = $1
     GROUP BY s.id, s.name`,
    [studentId, year, month]
  );
  return result.rows?.[0] || null;
}

export async function previewPaymentMonthMigration(monthValue) {
  const parsed = parseBillingMonth(monthValue);
  const rawCountResult = await query(
    `SELECT COUNT(*)::int AS count
       FROM payments
      WHERE year = $1 AND month = $2`,
    [parsed.year, parsed.month]
  );
  const aggregates = await getMonthAggregates(parsed);
  return {
    month: parsed.billingMonth,
    sourcePaymentRows: Number(rawCountResult.rows?.[0]?.count || 0),
    uniqueStudents: aggregates.length,
    students: aggregates.map((row) => ({
      studentId: String(row.student_id),
      studentName: String(row.student_name || ''),
      paymentCount: Number(row.payment_count || 0),
      total: row.total ?? 0,
      paidAt: row.paid_at ? String(row.paid_at) : '',
    })),
  };
}

export async function migratePaymentMonthToBookingSheet(monthValue) {
  const parsed = parseBillingMonth(monthValue);
  const aggregates = await getMonthAggregates(parsed);
  const records = aggregates.map((row) => aggregateRowToMirrorRecord(row, parsed.billingMonth));
  const sheetResult = await upsertBookingPaymentMirror(records);
  return {
    ok: true,
    month: parsed.billingMonth,
    sourcePaymentRows: records.reduce((sum, record) => sum + record.transactionIds.length, 0),
    uniqueStudents: records.length,
    ...sheetResult,
  };
}

function normalizePair(row) {
  const studentId = Number(row?.student_id ?? row?.studentId);
  const year = Number(row?.year);
  const month = Number(row?.month);
  if (!Number.isInteger(studentId) || studentId < 0) return null;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { studentId, year, month };
}

export async function syncPaymentPairsToBookingSheet(rows) {
  const unique = new Map();
  for (const row of rows || []) {
    const pair = normalizePair(row);
    if (!pair) continue;
    unique.set(`${pair.studentId}:${pair.year}-${pair.month}`, pair);
  }
  if (unique.size === 0) return { ok: true, skipped: true, reason: 'no-valid-payment-pairs' };

  const records = [];
  for (const pair of unique.values()) {
    const aggregate = await getStudentMonthAggregate(pair.studentId, pair.year, pair.month);
    if (!aggregate) continue;
    const billingMonth = `${String(pair.year).padStart(4, '0')}-${String(pair.month).padStart(2, '0')}`;
    records.push(aggregateRowToMirrorRecord(aggregate, billingMonth));
  }
  if (records.length === 0) return { ok: true, skipped: true, reason: 'students-not-found' };
  return upsertBookingPaymentMirror(records);
}

export async function safeSyncPaymentPairsToBookingSheet(rows) {
  try {
    return await syncPaymentPairsToBookingSheet(rows);
  } catch (err) {
    console.error('[payment-sheet-sync] Booking API payment sync failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
