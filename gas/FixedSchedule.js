/* Add this file to the Calendar GAS project. Dispatch before other doPost actions:
 * if (body && body.action === 'fixed_schedule_upsert') return fixedScheduleUpsert_(e, body);
 * Requires the Advanced Calendar service. No delete or recurrence API is used.
 */
function fixedScheduleUpsert_(e, body) {
  var reply = function (value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
      ContentService.MimeType.JSON,
    );
  };
  var supplied = String(
    (e && e.parameter && e.parameter.key) || body.key || '',
  );
  if (!getBookingApiKey_() || supplied !== getBookingApiKey_())
    return reply({ ok: false, error: 'Unauthorized' });
  if (
    !/^fs[0-9a-f]{64}$/.test(String(body.eventId || '')) ||
    !/^[0-9a-f]{64}$/.test(String(body.occurrenceId || ''))
  )
    return reply({ ok: false, error: 'Invalid fixed event identity' });
  if (
    ['reserved', 'scheduled', 'cancelled', 'rescheduled'].indexOf(
      body.status,
    ) === -1
  )
    return reply({ ok: false, error: 'Invalid appointment status' });
  var start = new Date(body.start),
    end = new Date(body.end);
  if (
    isNaN(start.getTime()) ||
    isNaN(end.getTime()) ||
    end - start !== 50 * 60000 ||
    !body.title
  )
    return reply({ ok: false, error: 'Invalid appointment' });
  var calendarId = getCalendarIdForKind_(body.lessonKind || 'regular');
  if (!calendarId)
    return reply({ ok: false, error: 'Calendar not configured' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return reply({
      ok: false,
      error: 'Calendar is busy; retry this appointment',
    });
  try {
    var existing = null;
    try {
      existing = Calendar.Events.get(calendarId, body.eventId);
    } catch (err) {
      if (!/404|not found/i.test(String(err))) throw err;
    }
    if (
      existing &&
      (existing.status === 'cancelled' ||
        existing.recurringEventId ||
        existing.recurrence ||
        !existing.extendedProperties ||
        !existing.extendedProperties.private ||
        existing.extendedProperties.private.fixedOccurrenceId !==
          body.occurrenceId)
    ) {
      return reply({
        ok: false,
        error:
          'Event is deleted, recurring, or not owned by this fixed appointment; manual review required',
      });
    }
    var description = existing
      ? String(existing.description || '')
      : String(body.description || '');
    var resource = {
      summary: String(body.title),
      description: description,
      location: String(body.location || ''),
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Tokyo' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Tokyo' },
      colorId:
        body.status === 'reserved'
          ? '5'
          : body.status === 'cancelled' || body.status === 'rescheduled'
            ? '8'
            : body.colorId
              ? String(body.colorId)
              : null,
      extendedProperties: {
        private: {
          fixedOccurrenceId: body.occurrenceId,
          fixedScheduleId: String(body.scheduleId),
          fixedStatus: body.status,
        },
      },
    };
    var saved;
    if (existing)
      saved = Calendar.Events.patch(resource, calendarId, body.eventId);
    else {
      resource.id = body.eventId;
      saved = Calendar.Events.insert(resource, calendarId);
    }
    return reply({
      ok: true,
      independent: true,
      iCalUID: saved && saved.iCalUID ? saved.iCalUID : null,
      eventId: body.eventId,
      actionTaken: existing ? 'updated' : 'created',
    });
  } catch (error) {
    return reply({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}
