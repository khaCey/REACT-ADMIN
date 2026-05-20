/**
 * Deploy in Web App doPost → lesson_book_update / lesson_book_delete.
 *
 * Student Admin sends:
 *   eventId            — target occurrence (…_YYYYMMDDTHHMMSSZ when recurring)
 *   seriesMasterId     — bare recurring series id (no instance suffix)
 *   occurrenceStartIso — original occurrence start (UTC ISO)
 *   updateScope        — 'thisInstanceOnly'
 *
 * For recurring events, never call setTitle/setColor on the series master when
 * updateScope is thisInstanceOnly — patch the single instance instead.
 */

function resolveRecurringInstanceEvent_(calendar, eventId, seriesMasterId, occurrenceStartIso) {
  var id = String(eventId || '').trim();
  if (id && /_\d{8}T\d{6}Z$/i.test(id)) {
    try {
      return calendar.getEventById(id);
    } catch (e) {}
  }
  var masterId = String(seriesMasterId || eventId || '').trim();
  if (!masterId || !occurrenceStartIso) return null;
  var start = new Date(occurrenceStartIso);
  if (isNaN(start.getTime())) return null;
  var end = new Date(start.getTime() + 60 * 60 * 1000);
  var series = calendar.getEventById(masterId);
  if (!series || !series.isRecurringEvent()) return series;
  var instances = series.getInstances(start, end);
  return instances && instances.length ? instances[0] : null;
}

// In lesson_book_update handler, after parsing body:
//   var ev = resolveRecurringInstanceEvent_(calendar, body.eventId, body.seriesMasterId, body.occurrenceStartIso);
//   if (!ev) return jsonError('event not found');
//   if (body.title) ev.setTitle(body.title);
//   if (body.colorId) ev.setColor(body.colorId);
//   …
