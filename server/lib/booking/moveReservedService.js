import { query } from '../../db/index.js';
import { individualFixedSchedules } from './individualFixedScheduleService.js';
export async function handleMoveReserved(req, res) {
  try {
    const managed = await query(
      'SELECT fixed_occurrence_id FROM monthly_schedule WHERE event_id = $1 LIMIT 1',
      [req.body?.event_id],
    );
    if (managed.rows[0]?.fixed_occurrence_id)
      return individualFixedSchedules.handleMove(req, res);
    return res
      .status(409)
      .json({
        error:
          'Confirm this legacy 固定 schedule first to convert it to independent events. Old recurring Calendar events must be removed manually.',
      });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
