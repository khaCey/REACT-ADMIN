import { createHash } from 'node:crypto';

export const LOCAL_EVENT_RE = /^(local-booking-|optimistic-|unscheduled-|pending-)/i;
const suffix = /_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/;
const iso = value => value ? new Date(value).toISOString() : null;
const clean = value => String(value || '').trim();
const norm = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
export const recoveryGoogleId = (oldId, calendarId) => 'rec0' + createHash('sha256').update(calendarId + '\n' + oldId).digest('hex');
export function monthlyRecoveryId(event, start) {
  const date = new Date(new Date(start).getTime() + 9 * 3600000).toISOString().slice(0,10);
  return `${event.iCalUID || event.id + '@google.com'}_${date}_${iso(start).slice(11,19).replace(/:/g,'-')}`;
}
export function groupRecoveryRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.event_id)) map.set(row.event_id, []);
    map.get(row.event_id).push(row);
  }
  return [...map].map(([eventId, members]) => ({ eventId, members, start: iso(members[0].start), end: iso(members[0].end), title: members[0].title || '', studentNames: members.map(r => r.student_name) }));
}
export function recoveryEligibility(group) {
  const rows = group.members;
  if (LOCAL_EVENT_RE.test(group.eventId)) return 'local_only';
  if (rows.some(r => !clean(r.calendar_google_event_id) && !clean(r.calendar_source_event_id) && !/@google\.com/.test(r.event_id))) return 'no_calendar_identity';
  if (new Set(rows.map(r => clean(r.calendar_google_event_id)).filter(Boolean)).size > 1 || new Set(rows.map(r => clean(r.calendar_source_event_id)).filter(Boolean)).size > 1) return 'ambiguous_calendar_identity';
  if (!group.start || !group.end || new Date(group.end) <= new Date(group.start)) return 'invalid_time';
  if (new Set(rows.map(r => r.lesson_uuid)).size !== 1 || !rows[0].lesson_uuid) return 'ambiguous_uuid';
  if (new Set(rows.map(r => iso(r.start) + '|' + iso(r.end))).size !== 1) return 'ambiguous_time';
  if (rows.some(r => !r.student_id)) return 'unlinked_student';
  if (rows.some(r => r.calendar_sync_status && r.calendar_sync_status !== 'synced' && !String(r.calendar_sync_error || '').startsWith('[calendar-style] '))) return 'not_previously_synced';
  return null;
}
export function classifyRecovery(group, events, calendarId) {
  const reason = recoveryEligibility(group);
  if (reason) return { ...group, members: undefined, status: 'excluded', reason };
  const ids = new Set(group.members.flatMap(r => [clean(r.calendar_google_event_id),clean(r.calendar_source_event_id),clean(r.event_id).replace(suffix,'')]).filter(Boolean));
  const found = events.find(e => {
    if (e.status === 'cancelled') return false;
    const eventStart = e.originalStartTime?.dateTime || e.start?.dateTime;
    return ids.has(e.id) || ((ids.has(e.iCalUID) || ids.has(e.recurringEventId)) && eventStart && iso(eventStart) === group.start);
  });
  if (found) return { ...group, members: undefined, status: 'present', foundEventId: found.id };
  const plannedId = recoveryGoogleId(group.eventId, calendarId);
  const alreadyCreated = events.find(e => e.id === plannedId && e.extendedProperties?.private?.adminRecoveryOldEventId === group.eventId);
  if (alreadyCreated) return { ...group, members: undefined, status: 'missing', reason: 'created_awaiting_link', recoveredEventId: plannedId };
  const conflict = events.find(e => e.status !== 'cancelled' && iso(e.start?.dateTime) === group.start && iso(e.end?.dateTime) === group.end && (
    norm(e.summary) === norm(group.title) || group.studentNames.some(name => norm(e.summary).includes(norm(name))) || group.members.some(r => new RegExp('\\b' + r.student_id + '\\b').test(e.description || ''))
  ));
  return { ...group, members: undefined, status: conflict ? 'review' : 'missing', reason: conflict ? 'possible_existing_replacement' : 'absent_from_successful_calendar_scan', foundEventId: conflict?.id };
}
export function recoveryPayload(group, calendarId) {
  const inactive = group.members.every(r => ['cancelled','rescheduled'].includes(r.status));
  return {
    id: recoveryGoogleId(group.eventId, calendarId), summary: group.title,
    start: { dateTime: group.start, timeZone: 'Asia/Tokyo' }, end: { dateTime: group.end, timeZone: 'Asia/Tokyo' },
    description: ['Source: Student Admin recovery', ...group.members.map(r => `StudentId: ${r.student_id}`), group.members[0].teacher_name ? '#teacher' + group.members[0].teacher_name : null].filter(Boolean).join('\n'),
    location: group.members[0].lesson_mode === 'cafe' ? 'Cafe' : group.members[0].lesson_mode === 'online' ? 'Online' : '',
    ...(inactive ? { colorId: '8' } : {}),
    extendedProperties: { private: { adminRecoveryOldEventId: group.eventId, lessonUuid: String(group.members[0].lesson_uuid) } },
  };
}
export function recoveryPollGuards(records) {
  return {
    preparedRawIds: new Set(records.filter(r => r.state === 'prepared').flatMap(r => [r.google_event_id, r.google_event_id + '@google.com'])),
    retiredMonthlyIds: new Set(records.filter(r => r.state === 'linked').map(r => r.old_event_id)),
  };
}
export function assertRecoveryRowsUnchanged(current, group) {
  const fields = ['student_name','student_id','lesson_uuid','status','title','teacher_name','lesson_kind','lesson_mode','calendar_google_event_id','calendar_source_event_id'];
  if (current.length !== group.members.length || current.some(r => !group.members.some(m => fields.every(k => String(m[k] ?? '') === String(r[k] ?? '')) && iso(m.start) === iso(r.start) && iso(m.end) === iso(r.end)))) throw new Error('Lesson changed during recovery. Run preview again.');
}
export async function relinkRecovery(client, group, event, calendarId) {
  const newId = monthlyRecoveryId(event, group.start);
  const oldId = group.eventId;
  const current = await client.query('SELECT * FROM monthly_schedule WHERE event_id=$1 FOR UPDATE', [oldId]);
  assertRecoveryRowsUnchanged(current.rows, group);
  await client.query(`UPDATE monthly_schedule SET event_id=$2, calendar_source_event_id=$3, calendar_google_event_id=$4, calendar_sync_status='synced', calendar_sync_error=NULL, calendar_synced_at=NOW() WHERE event_id=$1`, [oldId,newId,event.iCalUID || event.id+'@google.com',event.id]);
  await client.query('UPDATE reschedules SET from_event_id=$2 WHERE from_event_id=$1', [oldId,newId]);
  await client.query('UPDATE reschedules SET to_event_id=$2 WHERE to_event_id=$1', [oldId,newId]);
  await client.query('UPDATE demo_lesson_events SET source_event_id=$2 WHERE source_event_id=$1', [oldId,newId]);
  await client.query("UPDATE calendar_event_recoveries SET new_event_id=$2,state='linked',linked_at=NOW(),last_error=NULL WHERE old_event_id=$1 AND calendar_id=$3", [oldId,newId,calendarId]);
  return newId;
}
