/**
 * Paste into your deployed Calendar Web App (same project as lesson_book_update).
 * Mirrors Calendar API/Code.js — use when Calendar API/ is not the deployed source.
 *
 * In doPost → lesson_book_update, after title/color handling and before cacheMonthlyEventsForBothMonths():
 *
 *   if (body.mergeStudentAdminDescription && typeof body.mergeStudentAdminDescription === 'object') {
 *     try {
 *       var existingDescUpd = '';
 *       try { existingDescUpd = String(foundUpd.getDescription() || ''); } catch (gdUpd) {}
 *       var mergedDesc = mergeStudentAdminDescriptionIntoEvent_(existingDescUpd, body.mergeStudentAdminDescription);
 *       try { foundUpd.setDescription(mergedDesc); } catch (sdUpd) {}
 *     } catch (mergeUpdErr) {}
 *   }
 */

var STUDENT_ADMIN_DESC_BLOCK_ = '---student-admin---';

function stripStudentAdminDescriptionBlock_(desc) {
  var s = String(desc || '');
  var idx = s.indexOf(STUDENT_ADMIN_DESC_BLOCK_);
  if (idx < 0) return s;
  return s.substring(0, idx).replace(/\s+$/, '');
}

function mergeStudentAdminDescriptionIntoEvent_(existingDesc, merge) {
  if (!merge || typeof merge !== 'object') return String(existingDesc || '');
  var ar = merge.awaiting_reschedule_date;
  if (ar !== true && ar !== false) return String(existingDesc || '');
  var base = stripStudentAdminDescriptionBlock_(existingDesc).trim();
  var tail = STUDENT_ADMIN_DESC_BLOCK_ + '\nawaiting_reschedule_date=' + (ar ? '1' : '0');
  if (!base) return tail;
  return base + '\n\n' + tail;
}
