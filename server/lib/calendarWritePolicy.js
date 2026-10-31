/** Production Calendar writes are paused unless explicitly enabled. */
export function calendarWritesEnabled() {
  return process.env.CALENDAR_WRITES_ENABLED === 'true';
}
export const calendarWritesPaused = {
  code: 'CALENDAR_WRITES_DISABLED',
  error: 'Google Calendar changes are paused. Make Calendar changes manually while isolated testing is prepared.',
};
export function assertCalendarWritesEnabled() {
  if (!calendarWritesEnabled()) throw Object.assign(new Error(calendarWritesPaused.error), { code: calendarWritesPaused.code, status: 423 });
}
/** Reject Calendar-changing actions before they can change local lesson state. */
export function calendarWritePauseMiddleware(req, res, next) {
  if (calendarWritesEnabled() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.path.replace(/\/+$/, '');
  const scheduleWrite = path.startsWith('/schedule/') && path !== '/schedule/remove-local';
  const recoveryWrite = path === '/calendar-recovery/rebuild';
  if (scheduleWrite || recoveryWrite) return res.status(423).json(calendarWritesPaused);
  return next();
}
