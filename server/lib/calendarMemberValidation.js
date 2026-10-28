/** Do not feed parsed title fragments back into a group's Calendar title. */
export function canonicalEventMembers(members) {
  const result = [];
  for (const member of members) {
    const name = String(member.name || '').replace(/\s+/g, ' ').trim();
    if (member.id == null && (name.includes(',') || /\s(?:and|&)\s/i.test(name))) {
      throw new Error('Ambiguous Calendar group member: repair the unlinked composite student_name before rewriting its title');
    }
    const key = name.toLowerCase();
    if (!key) continue;
    const existing = result.findIndex(m => member.id != null && m.id != null ? m.id === member.id : String(m.name).toLowerCase() === key);
    if (existing >= 0) { if (member.id != null && result[existing].id == null) result[existing] = { ...member, name }; continue; }
    result.push({ ...member, name });
  }
  return result;
}

export function validateCalendarSnapshot(data) {
  for (const item of data) {
    const fields = { student_name: item.studentName ?? item.student_name ?? '', teacher_name: item.teacherName ?? item.teacher_name ?? '' };
    for (const [field, value] of Object.entries(fields)) {
      const length = Array.from(String(value).trim()).length;
      if (length > 255) {
        const error = new Error(`Calendar snapshot rejected before writes: ${field} has ${length} characters (maximum 255), date ${item.date}`);
        error.rowContext = { field, length, date: item.date, eventId: item.eventID || item.event_id };
        throw error;
      }
    }
  }
}
