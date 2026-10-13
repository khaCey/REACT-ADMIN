import test from 'node:test';
import assert from 'node:assert/strict';
import staffRouter from '../staff.js';
import { pool } from '../../db/index.js';

const route = staffRouter.stack.find(
  (layer) => layer.route?.path === '/:id' && layer.route?.methods?.delete
);
assert.ok(route, 'DELETE /:id route should be registered');
const deleteHandler = route.route.stack.at(-1).handle;

async function invokeDelete({ id = 8, requesterId = 1, row = { id: 8, name: 'Former Teacher', active: true }, failUpdate = false } = {}) {
  const originalConnect = pool.connect;
  const statements = [];
  let released = false;
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };

  pool.connect = async () => ({
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT')) return { rows: row ? [row] : [] };
      if (failUpdate && sql.startsWith('UPDATE staff SET')) throw new Error('database unavailable');
      return { rows: [] };
    },
    release() { released = true; },
  });
  try {
    await deleteHandler({ params: { id: String(id) }, staff: { id: requesterId } }, response);
    return { response, statements, released };
  } finally {
    pool.connect = originalConnect;
  }
}

test('staff deletion is reversible and preserves referenced data', async (t) => {
  await t.test('active staff is deactivated without deleting historical records', async () => {
    const { response, statements, released } = await invokeDelete();
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.staff.active, false);
    assert.ok(statements.some(({ sql }) => sql === 'UPDATE staff SET active = FALSE WHERE id = $1'));
    assert.ok(statements.some(({ sql }) => sql.startsWith('UPDATE staff_shifts SET ended_at')));
    assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(statements.every(({ sql }) => !sql.startsWith('DELETE FROM')));
    assert.equal(released, true);
  });

  await t.test('cannot delete the current account', async () => {
    const { response, statements } = await invokeDelete({ id: 1, requesterId: 1 });
    assert.equal(response.statusCode, 403);
    assert.equal(statements.length, 0);
  });

  await t.test('cannot delete the owner account', async () => {
    const { response, statements } = await invokeDelete({ row: { id: 8, name: 'Khacey', active: true } });
    assert.equal(response.statusCode, 403);
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(statements.every(({ sql }) => !sql.startsWith('UPDATE staff SET')));
  });

  await t.test('cannot repeat deletion of an inactive account', async () => {
    const { response, statements } = await invokeDelete({ row: { id: 8, name: 'Former Teacher', active: false } });
    assert.equal(response.statusCode, 409);
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
  });

  await t.test('returns 404 for a missing staff member', async () => {
    const { response, statements } = await invokeDelete({ row: null });
    assert.equal(response.statusCode, 404);
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
  });

  await t.test('rejects invalid ids without querying the database', async () => {
    const { response, statements } = await invokeDelete({ id: '8.1' });
    assert.equal(response.statusCode, 400);
    assert.equal(statements.length, 0);
  });

  await t.test('rolls back a failed deactivation', async () => {
    const { response, statements, released } = await invokeDelete({ failUpdate: true });
    assert.equal(response.statusCode, 500);
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!statements.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(released, true);
  });
});
