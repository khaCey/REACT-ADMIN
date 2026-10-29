import { getStoredToken } from '../utils/authSession'

// Retained for AuthContext's logout hook. No GAS credentials are held by the client.
export function clearPollingRuntimeConfig() {}

export async function fetchCalendarSyncStatus() {
  const token = getStoredToken()
  if (!token) throw new Error('Authentication required')
  const response = await fetch('/api/calendar-poll/status', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Unable to read Calendar sync status')
  return response.json()
}
