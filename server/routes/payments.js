import { Router } from 'express';
import { query, pool } from '../db/index.js';
import { randomUUID } from 'crypto';
import { logChange } from '../lib/changeLog.js';

const router = Router();

function newTransactionId() {
  return `TXN_${randomUUID().slice(0, 8)}`;
}

function paymentInsertParams(body, transactionId) {
  return [
    transactionId,
    body['Student ID'] ?? body.student_id,
    body.Year ?? body.year,
    body.Month ?? body.month,
    body.Amount ?? body.amount ?? 0,
    body.Discount ?? body.discount ?? 0,
    body.Total ?? body.total ?? 0,
    body.Date ?? body.date,
    body.Method ?? body.method ?? '',
    body.Staff ?? body.staff ?? '',
  ];
}

/** Other members of the payer's linked group (same group_id), excluding the payer. */
async function getOtherGroupMemberStudentIds(payerStudentId) {
  const g = await query(`SELECT group_id FROM student_group_members WHERE student_id = $1 LIMIT 1`, [
    payerStudentId,
  ]);
  if (g.rows.length === 0) return [];
  const groupId = g.rows[0].group_id;
  const m = await query(
    `SELECT student_id FROM student_group_members WHERE group_id = $1 AND student_id <> $2 ORDER BY student_id`,
    [groupId, payerStudentId]
  );
  return m.rows.map((r) => r.student_id);
}

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM payments ORDER BY date DESC, created_at DESC'
    );
    const payments = result.rows.map((r) => ({
      'Transaction ID': r.transaction_id,
      'Student ID': r.student_id,
      Year: r.year,
      Month: r.month,
      Amount: r.amount,
      Discount: r.discount,
      Total: r.total,
      Date: r.date,
      Method: r.method,
      Staff: r.staff,
    }));
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const replicate =
      body.replicate_to_linked_group === true || body.replicateToLinkedGroup === true;
    const payerIdRaw = body['Student ID'] ?? body.student_id;
    const payerId = typeof payerIdRaw === 'number' ? payerIdRaw : Number(payerIdRaw);

    const transactionId = body['Transaction ID'] || body.transaction_id || newTransactionId();

    const peerIds =
      replicate && Number.isFinite(payerId) && Number.isInteger(payerId) && payerId >= 0
        ? await getOtherGroupMemberStudentIds(payerId)
        : [];

    if (!replicate || peerIds.length === 0) {
      const insertResult = await query(
        `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        paymentInsertParams(body, transactionId)
      );
      const newRow = insertResult.rows[0];
      await logChange(
        {
          entityType: 'payments',
          entityKey: transactionId,
          action: 'create',
          oldData: null,
          newData: newRow,
        },
        req
      );
      return res.status(201).json({
        transaction_id: transactionId,
        replicated_transaction_ids: [],
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        paymentInsertParams(body, transactionId)
      );
      const primaryRow = insertResult.rows[0];
      await logChange(
        {
          entityType: 'payments',
          entityKey: transactionId,
          action: 'create',
          oldData: null,
          newData: primaryRow,
        },
        req,
        client
      );

      const replicatedIds = [];
      for (const otherStudentId of peerIds) {
        const tid = newTransactionId();
        const replicaBody = { ...body, student_id: otherStudentId, 'Student ID': otherStudentId };
        const replicaResult = await client.query(
          `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          paymentInsertParams(replicaBody, tid)
        );
        const repRow = replicaResult.rows[0];
        await logChange(
          {
            entityType: 'payments',
            entityKey: tid,
            action: 'create',
            oldData: null,
            newData: repRow,
          },
          req,
          client
        );
        replicatedIds.push(tid);
      }

      await client.query('COMMIT');
      return res.status(201).json({
        transaction_id: transactionId,
        replicated_transaction_ids: replicatedIds,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const body = req.body;
    const oldResult = await query('SELECT * FROM payments WHERE transaction_id = $1', [transactionId]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const oldRow = oldResult.rows[0];
    await query(
      `UPDATE payments SET
        student_id = COALESCE($2, student_id),
        year = COALESCE($3, year),
        month = COALESCE($4, month),
        amount = COALESCE($5, amount),
        discount = COALESCE($6, discount),
        total = COALESCE($7, total),
        date = COALESCE($8, date),
        method = COALESCE($9, method),
        staff = COALESCE($10, staff)
       WHERE transaction_id = $1`,
      [
        transactionId,
        body['Student ID'] ?? body.student_id,
        body.Year ?? body.year,
        body.Month ?? body.month,
        body.Amount ?? body.amount,
        body.Discount ?? body.discount,
        body.Total ?? body.total,
        body.Date ?? body.date,
        body.Method ?? body.method,
        body.Staff ?? body.staff,
      ]
    );
    const newRow = (await query('SELECT * FROM payments WHERE transaction_id = $1', [transactionId])).rows[0];
    await logChange(
      {
        entityType: 'payments',
        entityKey: transactionId,
        action: 'update',
        oldData: oldRow,
        newData: newRow,
      },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const oldResult = await query('SELECT * FROM payments WHERE transaction_id = $1', [transactionId]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const oldRow = oldResult.rows[0];
    await query('DELETE FROM payments WHERE transaction_id = $1', [transactionId]);
    await logChange(
      {
        entityType: 'payments',
        entityKey: transactionId,
        action: 'delete',
        oldData: oldRow,
        newData: null,
      },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
