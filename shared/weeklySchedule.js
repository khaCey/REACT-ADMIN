const DAY = 86400000;
export function addDays(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}
export function japanToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function weekRange(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error('Use a valid date in YYYY-MM-DD format');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error('Use a valid calendar date');
  const start = addDays(value, -((d.getUTCDay() + 6) % 7));
  return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}
export function groupWeekLessons(rows) {
  const events = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.event_id, row.date, row.start, row.end]);
    if (!events.has(key)) events.set(key, { key, eventId: row.event_id, date: row.date, start: row.start,
      end: row.end, title: row.title, teacher: row.teacher_name, kind: row.lesson_kind,
      kids: !!row.is_kids_lesson, members: [] });
    events.get(key).members.push({ id: row.student_id, name: row.student_name, status: row.status,
      awaitingDate: !!row.awaiting_reschedule_date, syncStatus: row.calendar_sync_status });
  }
  return [...events.values()];
}
/** Clip spanning lessons to each Japan calendar day; retain untimed records separately. */
export function splitWeekLessons(events, days) {
  const timed = []; const untimed = [];
  for (const event of events) {
    const start = event.start ? Date.parse(event.start) : NaN;
    let end = event.end ? Date.parse(event.end) : NaN;
    if (!Number.isFinite(start)) { untimed.push(event); continue; }
    if (!Number.isFinite(end) || end <= start) end = start + 50 * 60000;
    for (const day of days) {
      const midnight = Date.parse(day + 'T00:00:00+09:00');
      const a = Math.max(start, midnight); const b = Math.min(end, midnight + DAY);
      if (b > a) timed.push({ ...event, day, from: (a - midnight) / 60000, to: (b - midnight) / 60000 });
    }
  }
  return { timed, untimed };
}
/** Assign columns per connected overlap cluster, including nested/chain overlaps. */
export function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.from - b.from || b.to - a.to || a.key.localeCompare(b.key));
  const result = []; let cluster = []; let end = -1;
  const flush = () => {
    const lanes = [];
    for (const item of cluster) {
      let lane = lanes.findIndex(until => until <= item.from);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = item.to;
      item.lane = lane;
    }
    for (const item of cluster) result.push({ ...item, columns: lanes.length });
    cluster = [];
  };
  for (const original of sorted) {
    if (cluster.length && original.from >= end) flush();
    if (!cluster.length) end = -1;
    cluster.push({ ...original }); end = Math.max(end, original.to);
  }
  flush(); return result;
}
