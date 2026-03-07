const API_BASE = '/api';
const TOKEN_KEY = 'staff_token';

async function fetchApi(path, options = {}) {
  await new Promise((r) => setTimeout(r, 500)); // 0.5s delay for CRUD
  const url = `${API_BASE}${path}`;
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = err.error || res.statusText;
    const pathHint = err.path ? ` (${err.path})` : '';
    throw new Error(msg + pathHint);
  }
  return res.json();
}

export const api = {
  getStudents: () => fetchApi('/students'),
  getStudent: (id) => fetchApi(`/students/${id}`),
  getStudentLatestByMonth: (id) => fetchApi(`/students/${id}/latest-by-month`),
  addStudent: (data) => fetchApi('/students', { method: 'POST', body: JSON.stringify(data) }),
  updateStudent: (id, data) => fetchApi(`/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStudent: (id) => fetchApi(`/students/${id}`, { method: 'DELETE' }),

  getPayments: () => fetchApi('/payments'),
  addPayment: (data) => fetchApi('/payments', { method: 'POST', body: JSON.stringify(data) }),
  updatePayment: (id, data) => fetchApi(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePayment: (id) => fetchApi(`/payments/${id}`, { method: 'DELETE' }),

  getNotes: (studentId) =>
    fetchApi(`/notes${studentId != null ? `?student_id=${encodeURIComponent(studentId)}` : ''}`),
  addNote: (data) => fetchApi('/notes', { method: 'POST', body: JSON.stringify(data) }),
  updateNote: (id, data) => fetchApi(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNote: (id) => fetchApi(`/notes/${id}`, { method: 'DELETE' }),

  getFeatureFlags: () => fetchApi('/config/feature-flags'),
  getStaffShifts: () => fetchApi('/auth/shifts'),
  getUnreadNotifications: (limit = 20) =>
    fetchApi(`/notifications/unread?limit=${encodeURIComponent(limit)}`),
  markNotificationRead: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  markNotificationUnread: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}/unread`, { method: 'POST' }),
  getNotifications: ({ limit = 50, offset = 0 } = {}) =>
    fetchApi(`/notifications?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),
  getNotificationStaff: () => fetchApi('/notifications/staff'),
  createNotification: (data) =>
    fetchApi('/notifications', { method: 'POST', body: JSON.stringify(data) }),
  updateNotification: (id, data) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNotification: (id) =>
    fetchApi(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getUnpaidStudents: (month) =>
    fetchApi(month ? `/dashboard/unpaid?month=${encodeURIComponent(month)}` : '/dashboard/unpaid'),
  getUnscheduledLessonsStudents: () => fetchApi('/dashboard/unscheduled-lessons'),

  getWeekSchedule: (weekStart) =>
    fetchApi(`/schedule/week?week_start=${encodeURIComponent(weekStart)}`, { cache: 'no-store' }),
  getBookingWarning: (date, time, studentId) => {
    const params = new URLSearchParams({ date, time });
    if (studentId) params.set('student_id', studentId);
    return fetchApi(`/schedule/booking-warning?${params.toString()}`);
  },
  bookLesson: (body) =>
    fetchApi('/schedule/book', { method: 'POST', body: JSON.stringify(body) }),
  cancelScheduleEvent: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/cancel`, { method: 'PATCH' }),
  uncancelScheduleEvent: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/uncancel`, { method: 'PATCH' }),
  rescheduleScheduleEvent: (eventId, body) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}/reschedule`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeScheduleEvent: (eventId) =>
    fetchApi(`/schedule/${encodeURIComponent(eventId)}`, { method: 'DELETE' }),

  getScheduleTeachers: (date) =>
    fetchApi(`/schedule/teachers?date=${encodeURIComponent(date)}`),
  getScheduleExtend: (date, teacherName) =>
    fetchApi(`/schedule/extend?date=${encodeURIComponent(date)}&teacher_name=${encodeURIComponent(teacherName)}`),
  updateScheduleExtend: (body) =>
    fetchApi('/schedule/extend', { method: 'PUT', body: JSON.stringify(body) }),

  syncCalendarPoll: (data) =>
    fetchApi('/calendar-poll/sync', { method: 'POST', body: JSON.stringify({ data }) }),

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
