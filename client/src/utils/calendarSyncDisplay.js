export const CALENDAR_STYLE_PENDING_ERROR = '[calendar-style] Pending Calendar update'

/**
 * A Calendar event's existence and its latest title/colour update differ.
 * This is only a display classification and does not alter sync records.
 */
export function getCalendarSyncDisplayState(status, error) {
  const syncStatus = String(status || 'synced').trim().toLowerCase()
  const syncError = String(error || '').trim()
  if (syncError === CALENDAR_STYLE_PENDING_ERROR && syncStatus !== 'synced') {
    return 'calendar_style_pending'
  }
  if (syncStatus === 'failed' && syncError.startsWith('[calendar-style] ')) {
    return 'calendar_style_failed'
  }
  if (syncStatus === 'failed') return 'sync_failed'
  if (syncStatus === 'pending') return 'calendar_pending'
  return 'synced'
}
