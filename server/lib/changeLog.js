/**
 * Change log helper - records data modifications for audit and undo
 */
import { query } from '../db/index.js';

export async function logChange({ entityType, entityKey, action, oldData, newData }, req) {
  const staff = req?.staff || {};
  const staffId = staff.id ?? null;
  const staffName = staff.name ?? null;

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
