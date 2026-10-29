import { createContext, useContext } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { useAuth } from './AuthContext'

const CalendarPollingContext = createContext(null)

export function useCalendarPollingContext() {
  return useContext(CalendarPollingContext) ?? { data: [], loading: false, error: null, lastSynced: null, refetch: () => {}, isConfigured: false }
}

export function CalendarPollingProvider({ children, intervalMs = 30000 }) {
  const { staff, loading } = useAuth()
  const polling = useCalendarPolling({ intervalMs, enabled: !!staff && !loading })
  const value = { ...polling, lastSynced: polling.lastUpdated ? `${polling.lastUpdated}:${polling.cacheVersion}` : null }
  return <CalendarPollingContext.Provider value={value}>{children}</CalendarPollingContext.Provider>
}
