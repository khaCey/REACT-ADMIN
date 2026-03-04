/**
 * Change log helper - records data modifications for audit and undo
 */
import { query } from '../db/index.js';

export async function logChange({ entityType, entityKey, action, oldData, newData, sourceChangeId = null }, req) {
  const staff = req?.staff || {};
  const staffId = staff.id ?? null;
  const staffName = staff.name ?? null;

  try {
    await query(
      `INSERT INTO change_log (entity_type, entity_key, action, old_data, new_data, source_change_id, staff_id, staff_name)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
      [
        entityType,
        String(entityKey),
        action,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        sourceChangeId,
        staffId,
        staffName,
      ]
    );
  } catch (err) {
    // Backward compatibility for databases that haven't added source_change_id yet.
    if (err?.code !== '42703') throw err;
    await query(
      `INSERT INTO change_log (entity_type, entity_key, action, old_data, new_data, staff_id, staff_name)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        entityType,
        String(entityKey),
        action,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        staffId,
        staffName,
      ]
    );
  }
}
