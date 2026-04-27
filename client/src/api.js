import { clearStoredSession, getStoredToken } from './utils/authSession';

const API_BASE = '/api';

async function fetchApi(path, options = {}) {
  // await new Promise((r) => setTimeout(r, 500)); // 0.5s delay for CRUD
  const url = `${API_BASE}${path}`;
  const token = getStoredToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) clearStoredSession();
    const msg = err.error || res.statusText;
    const pathHint = err.path ? ` (${err.path})` : '';
    throw new Error(msg + pathHint);
  }
  return res.json();
}

export const api = {
  getStudents: () => fetchApi('/students'),
  getStudent: (id) => fetchApi(`/students/${id}`),
  getStudentGroup: (id) => fetchApi(`/students/${id}/group`),
  saveStudentGroup: (id, body) =>
    fetchApi(`/students/${id}/group`, { method: 'PUT', body: JSON.stringify(body) }),
  getStudentLatestByMonth: (id) => fetchApi(`/students/${id}/latest-by-month`),
  addStudent: (data) => fetchApi('/students', { method: 'POST', body: JSON.stringify(data) }),
  updateStudent: (id, data) => fetchApi(`/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  syncStudentGoogleContact: (id) => fetchApi(`/students/${id}/google-contact-sync`, { method: 'POST' }),
  deleteStudent: (id) => fetchApi(`/students/${id}`, { method: 'DELETE' }),

  getPayments: () => fetchApi('/payments'),
  /** POST body may include `replicate_to_linked_group: true` and optional `linked_group_id` (from getStudentGroup) so replication matches the UI group. */
  addPayment: (data) => fetchApi('/payments', { method: 'POST', body: JSON.stringify(data) }),
  /** PUT/DELETE on a linked payment transaction auto-propagates to all rows in its linked payment batch. */
  updatePayment: (id, data) => fetchApi(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePayment: (id) => fetchApi(`/payments/${id}`, { method: 'DELETE' }),

  getNotes: (studentId) =>
    fetchApi(`/notes${studentId != null ? `?student_id=${encodeURIComponent(studentId)}` : ''}`),
  getLessonNotes: (lessonUuid) =>
    fetchApi(`/notes/lessons/${encodeURIComponent(lessonUuid)}`),
  addLessonNote: (data) =>
    fetchApi('/notes/lessons', { method: 'POST', body: JSON.stringify(data) }),
  updateLessonNote: (id, data) =>
    fetchApi(`/notes/lessons/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLessonNote: (id) =>
    fetchApi(`/notes/lessons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** POST body may include `replicate_to_linked_group: true` and optional `linked_group_id` to duplicate note rows for linked members. */
  addNote: (data) => fetchApi('/notes', { method: 'POST', body: JSON.stringify(data) }),
  /** PUT/DELETE on a linked note id auto-propagates to all rows in its linked note batch. */
  updateNote: (id, data) => fetchApi(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNote: (id) => fetchApi(`/notes/${id}`, { method: 'DELETE' }),

  /** Upsert monthly lesson pack size (`lessons` table); `month` is YYYY-MM. */
  upsertStudentMonthLessons: ({ student_id, month, lessons }) =>
    fetchApi('/lessons', {
      method: 'POST',
      body: JSON.stringify({
        student_id,
        month,
        lessons,
      }),
    }),

  getFeatureFlags: () => fetchApi('/config/feature-flags'),
  getCalendarPollConfigured: () => fetchApi('/config/calendar-poll-configured'),
  createBackup: () => fetchApi('/admin/backup', { method: 'POST' }),
  getBackups: () => fetchApi('/admin/backups'),
  restoreBackup: (backupId) =>
    fetchApi('/admin/restore', { method: 'POST', body: JSON.stringify({ backupId }) }),
  clearTable: (table) =>
    fetchApi('/admin/clear-table', { method: 'POST', body: JSON.stringify({ table }) }),
  getAdminMonthlyScheduleEntries: ({ studentId = '', syncStatus = '', status = '', q = '', limit = 100, offset = 0 } = {}) => {
    const params = new URLSearchParams()
    if (studentId !== '' && studentId != null) params.set('studentId', String(studentId))
    if (syncStatus) params.set('syncStatus', String(syncStatus))
    if (status) params.set('status', String(status))
    if (q) params.set('q', String(q))
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    return fetchApi(`/admin/monthly-schedule?${params.toString()}`)
  },
  deleteAdminMonthlyScheduleEntry: ({ eventId, studentName }) =>
    fetchApi(
      `/admin/monthly-schedule/${encodeURIComponent(eventId)}?studentName=${encodeURIComponent(studentName)}`,
      { method: 'DELETE' }
    ),
  fetchStaffSchedule: () =>
    fetchApi('/admin/fetch-staff-schedule', { method: 'POST' }),
  /** Japanese staff + legacy untyped rows with calendar_id (same GAS as English teachers). */
  fetchJapaneseStaffSchedule: () =>
    fetchApi('/admin/fetch-japanese-staff-schedule', { method: 'POST' }),
  fetchStaffScheduleForStaff: (staffId) =>
    fetchApi(`/admin/fetch-staff-schedule/${staffId}`, { method: 'POST' }),
  testGas: (calendarId) =>
    fetchApi(`/admin/test-gas${calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : ''}`),
  getStaffShifts: () => fetchApi('/auth/shifts'),
  getStaffList: () => fetchApi('/auth/staff-list'),
  getStaff: () => fetchApi('/staff'),
  updateStaff: (id, data) => fetchApi(`/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteStaff: (id) => fetchApi(`/staff/${id}`, { method: 'DELETE' }),
  createStaff: (data) => fetchApi('/auth/staff', { method: 'POST', body: JSON.stringify(data) }),
  getShiftsWeek: (weekStart) =>
    fetchApi(`/shifts/week?week_start=${encodeURIComponent(weekStart)}`),
  getTeacherCalendar: (weekStart) =>
    fetchApi(`/shifts/teacher-calendar?week_start=${encodeURIComponent(weekStart)}`),
  assignShift: (body) => fetchApi('/shifts/assign', { method: 'PUT', body: JSON.stringify(body) }),
  getTeacherBreakPresets: (params = {}) => {
    const q = new URLSearchParams()
    if (params.teacher_name) q.set('teacher_name', String(params.teacher_name))
    if (params.weekday != null && params.weekday !== '') q.set('weekday', String(params.weekday))
    const qs = q.toString()
    return fetchApi(`/shifts/break-presets${qs ? `?${qs}` : ''}`)
  },
  createTeacherBreakPreset: (body) =>
    fetchApi('/shifts/break-presets', { method: 'POST', body: JSON.stringify(body) }),
  updateTeacherBreakPreset: (id, body) =>
    fetchApi(`/shifts/break-presets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTeacherBreakPreset: (id) =>
    fetchApi(`/shifts/break-presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getUnreadNotifications: (limit = 20, { excludeGuides = false } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (excludeGuides) q.set('excludeGuides', '1')
    return fetchApi(`/notifications/unread?${q}`)
  },
  markNotificationRead: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  markNotificationUnread: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}/unread`, { method: 'POST' }),
  getNotifications: ({ limit = 50, offset = 0, excludeGuides = false } = {}) => {
    const q = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (excludeGuides) q.set('excludeGuides', '1')
    return fetchApi(`/notifications?${q}`)
  },
  getNotificationStaff: () => fetchApi('/notifications/staff'),
  createNotification: (data) =>
    fetchApi('/notifications', { method: 'POST', body: JSON.stringify(data) }),
  updateNotification: (id, data) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNotification: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMessageStaff: () => fetchApi('/messages/staff'),
  getMessageConversations: ({ limit = 50, offset = 0 } = {}) => {
    const q = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    return fetchApi(`/messages/conversations?${q}`)
  },
  createMessageConversation: (data) =>
    fetchApi('/messages/conversations', { method: 'POST', body: JSON.stringify(data) }),
  getMessageConversation: (conversationId) =>
    fetchApi(`/messages/conversations/${encodeURIComponent(conversationId)}`),
  getMessageItems: (conversationId, { limit = 50, before = null } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (before != null && before !== '') q.set('before', String(before))
    return fetchApi(`/messages/conversations/${encodeURIComponent(conversationId)}/items?${q.toString()}`)
  },
  sendMessageItem: (conversationId, body) =>
    fetchApi(`/messages/conversations/${encodeURIComponent(conversationId)}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  markMessageConversationRead: (conversationId, lastReadMessageId = null) =>
    fetchApi(`/messages/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
      body: JSON.stringify({ last_read_message_id: lastReadMessageId }),
    }),

  getUnpaidStudents: (month) =>
    fetchApi(month ? `/dashboard/unpaid?month=${encodeURIComponent(month)}` : '/dashboard/unpaid'),
  getUnscheduledLessonsStudents: () => fetchApi('/dashboard/unscheduled-lessons'),
  getTodayLessons: () => fetchApi('/dashboard/today-lessons'),
  getDashboardMetrics: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return fetchApi(`/dashboard/metrics${params.toString() ? '?' + params.toString() : ''}`);
  },

  getWeekSchedule: (weekStart, opts = {}) => {
    const params = new URLSearchParams({ week_start: weekStart });
    if (opts.studentId != null && opts.studentId !== '') {
      params.set('student_id', String(opts.studentId));
    }
    const dm =
      opts.durationMinutes != null && opts.durationMinutes !== ''
        ? Number(opts.durationMinutes)
        : 50;
    params.set('duration_minutes', String(Number.isFinite(dm) ? dm : 50));
    return fetchApi(`/schedule/week?${params.toString()}`, { cache: 'no-store' });
  },
  getBookingWarning: (date, time, studentId) => {
    const params = new URLSearchParams({ date, time });
    if (studentId != null && studentId !== '') params.set('student_id', studentId);
    return fetchApi(`/schedule/booking-warning?${params.toString()}`);
  },
  bookLesson: (body) =>
    fetchApi('/schedule/book', { method: 'POST', body: JSON.stringify(body) }),
  /** Upsert month pack and renumber lesson titles in DB for that month (i/N). */
  renumberMonthLessonTitles: (body) =>
    fetchApi('/schedule/renumber-month-titles', { method: 'POST', body: JSON.stringify(body) }),
  syncScheduleEvent: (eventId) =>
    fetchApi('/schedule/sync', { method: 'POST', body: JSON.stringify({ event_id: eventId }) }),
  cancelScheduleEvent: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/cancel`, { method: 'PATCH' }),
  /** Cancel in calendar (graphite) but mark as awaiting new date (orange in app). */
  rescheduleAwaitingDate: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/reschedule-awaiting-date`, { method: 'POST' }),
  uncancelScheduleEvent: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/uncancel`, { method: 'PATCH' }),
  rescheduleScheduleEvent: (eventId, body) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/reschedule`, { method: 'PATCH', body: JSON.stringify(body) }),
  rescheduleLesson: (body) =>
    fetchApi('/schedule/reschedule-linked', { method: 'POST', body: JSON.stringify(body) }),
  unrescheduleLinkedLesson: (body) =>
    fetchApi('/schedule/unreschedule-linked', { method: 'POST', body: JSON.stringify(body) }),
  /** @param {{ localOnly?: boolean }} [opts] — when true, server skips Google Calendar (GAS) delete */
  removeScheduleEvent: (eventId, { localOnly = false } = {}) => {
    const q = localOnly ? '?localOnly=1' : ''
    return fetchApi(`/schedule/${encodeURIComponent(eventId)}${q}`, { method: 'DELETE' })
  },

  getScheduleTeachers: (date) =>
    fetchApi(`/schedule/teachers?date=${encodeURIComponent(date)}`),
  getScheduleExtend: (date, teacherName) =>
    fetchApi(`/schedule/extend?date=${encodeURIComponent(date)}&teacher_name=${encodeURIComponent(teacherName)}`),
  updateScheduleExtend: (body) =>
    fetchApi('/schedule/extend', { method: 'PUT', body: JSON.stringify(body) }),

  syncCalendarPoll: ({ data = [], removed = [] } = {}) =>
    fetchApi('/calendar-poll/sync', {
      method: 'POST',
      body: JSON.stringify({ data: Array.isArray(data) ? data : [], removed: Array.isArray(removed) ? removed : [] }),
    }),

  /** Server-side backfill (uses .env on server; no client build needed) */
  backfillFromCalendar: (body) =>
    fetchApi('/calendar-poll/backfill', { method: 'POST', body: JSON.stringify(body) }),

  syncFromSheet: () =>
    fetchApi('/calendar-poll/sync-from-sheet', { method: 'POST' }),

  getCalendarEvents: (timeMin, timeMax) => {
    const params = new URLSearchParams();
    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);
    return fetchApi(`/calendar/events?${params.toString()}`);
  },

  getChangeLog: (params = {}) => {
    const q = new URLSearchParams();
    if (params.entity_type) q.set('entity_type', params.entity_type);
    if (params.entity_key) q.set('entity_key', params.entity_key);
    if (params.limit) q.set('limit', params.limit);
    if (params.offset) q.set('offset', params.offset);
    const query = q.toString();
    return fetchApi(`/change-log${query ? `?${query}` : ''}`);
  },
  undoChange: (id) =>
    fetchApi(`/change-log/${id}/undo`, { method: 'POST' }),
  redoChange: (id) =>
    fetchApi(`/change-log/${id}/redo`, { method: 'POST' }),
};
