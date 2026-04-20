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

function parseBodyStudentId(raw) {
  if (raw == null || raw === '') return NaN;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

/**
 * Other members of the payer's linked group (same group_id), excluding the payer.
 * @param {number} payerStudentId
 * @param {number | null | undefined} preferredGroupId When set (e.g. from GET /students/:id/group), must match that group so POST matches the UI.
 */
async function resolveReplicationTargets(payerStudentId, preferredGroupId = null, db = query) {
  let groupId = null;
  const pref =
    preferredGroupId != null && preferredGroupId !== ''
      ? parseBodyStudentId(preferredGroupId)
      : NaN;
  if (Number.isInteger(pref) && pref > 0) {
    const member = await db(
      `SELECT 1 FROM student_group_members WHERE group_id = $1 AND student_id = $2 LIMIT 1`,
      [pref, payerStudentId]
    );
    if (member.rows.length > 0) {
      groupId = pref;
    }
  }
  if (groupId == null) {
    const g = await db(
      `SELECT group_id FROM student_group_members WHERE student_id = $1 ORDER BY group_id ASC LIMIT 1`,
      [payerStudentId]
    );
    if (g.rows.length === 0) return { groupId: null, peerIds: [] };
    groupId = g.rows[0].group_id;
  }
  const m = await db(
    `SELECT student_id FROM student_group_members WHERE group_id = $1 AND student_id <> $2 ORDER BY student_id`,
    [groupId, payerStudentId]
  );
  return { groupId, peerIds: m.rows.map((r) => r.student_id) };
}

async function getLinkedPaymentGroupId(transactionId, db = query) {
  const result = await db(
    `SELECT payment_group_id
       FROM payment_group_items
      WHERE transaction_id = $1
      LIMIT 1`,
    [transactionId]
  );
  return result.rows[0]?.payment_group_id ?? null;
}

async function getPaymentsByGroupId(paymentGroupId, db = query) {
  const result = await db(
    `SELECT p.*
       FROM payments p
       INNER JOIN payment_group_items pgi ON pgi.transaction_id = p.transaction_id
      WHERE pgi.payment_group_id = $1
      ORDER BY p.transaction_id ASC`,
    [paymentGroupId]
  );
  return result.rows;
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
    const payerId = parseBodyStudentId(body['Student ID'] ?? body.student_id);
    const preferredGroupRaw = body.linked_group_id ?? body.linkedGroupId;

    const transactionId = body['Transaction ID'] || body.transaction_id || newTransactionId();

    const replicationTargets =
      replicate && Number.isInteger(payerId) && payerId >= 0
        ? await resolveReplicationTargets(payerId, preferredGroupRaw)
        : { groupId: null, peerIds: [] };
    const peerIds = replicationTargets.peerIds;

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
      const linkedPayments = [{ transactionId, studentId: payerId, isPrimary: true }];
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
        linkedPayments.push({ transactionId: tid, studentId: otherStudentId, isPrimary: false });
      }

      const paymentGroupId = randomUUID();
      await client.query(
        `INSERT INTO payment_groups (id, source_group_id)
         VALUES ($1, $2)`,
        [paymentGroupId, replicationTargets.groupId]
      );
      for (const linkedPayment of linkedPayments) {
        await client.query(
          `INSERT INTO payment_group_items (payment_group_id, transaction_id, student_id, is_primary)
           VALUES ($1, $2, $3, $4)`,
          [
            paymentGroupId,
            linkedPayment.transactionId,
            linkedPayment.studentId,
            linkedPayment.isPrimary,
          ]
        );
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
    const linkedGroupId = await getLinkedPaymentGroupId(transactionId);
    if (linkedGroupId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRows = await getPaymentsByGroupId(linkedGroupId, client.query.bind(client));
        if (oldRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Payment not found' });
        }
        const updateResult = await client.query(
          `UPDATE payments p
              SET year = COALESCE($2, p.year),
                  month = COALESCE($3, p.month),
                  amount = COALESCE($4, p.amount),
                  discount = COALESCE($5, p.discount),
                  total = COALESCE($6, p.total),
                  date = COALESCE($7, p.date),
                  method = COALESCE($8, p.method),
                  staff = COALESCE($9, p.staff)
             FROM payment_group_items pgi
            WHERE pgi.payment_group_id = $1
              AND p.transaction_id = pgi.transaction_id
          RETURNING p.*`,
          [
            linkedGroupId,
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
        const newRowsById = new Map(updateResult.rows.map((row) => [row.transaction_id, row]));
        for (const oldRow of oldRows) {
          const newRow = newRowsById.get(oldRow.transaction_id);
          if (!newRow) continue;
          await logChange(
            {
              entityType: 'payments',
              entityKey: oldRow.transaction_id,
              action: 'update',
              oldData: oldRow,
              newData: newRow,
            },
            req,
            client
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, propagated: true, affected_count: updateResult.rows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
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
    const linkedGroupId = await getLinkedPaymentGroupId(transactionId);
    if (linkedGroupId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRows = await getPaymentsByGroupId(linkedGroupId, client.query.bind(client));
        if (oldRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Payment not found' });
        }
        await client.query(
          `DELETE FROM payments p
            USING payment_group_items pgi
           WHERE pgi.payment_group_id = $1
             AND p.transaction_id = pgi.transaction_id`,
          [linkedGroupId]
        );
        for (const oldRow of oldRows) {
          await logChange(
            {
              entityType: 'payments',
              entityKey: oldRow.transaction_id,
              action: 'delete',
              oldData: oldRow,
              newData: null,
            },
            req,
            client
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, propagated: true, deleted_count: oldRows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
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
