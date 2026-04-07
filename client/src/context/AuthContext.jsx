/**
 * Auth context - staff login for shift start
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { clearPollingRuntimeConfig } from '../api/pollingApi'
import {
  clearStoredSession,
  getStoredToken,
  getStoredTokenExpiry,
  isStoredSessionExpired,
  SESSION_EVENT,
  setStoredSession,
} from '../utils/authSession'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  return ctx ?? { staff: null, loading: true, login: async () => {}, logout: () => {}, setStaff: () => {} }
}

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  const clearSession = useCallback(() => {
    clearStoredSession()
    clearPollingRuntimeConfig()
    setStaff(null)
  }, [])

  const getToken = () => getStoredToken()

  const fetchMe = useCallback(async () => {
    if (isStoredSessionExpired()) {
      clearSession()
      setLoading(false)
      return
    }
    const token = getToken()
    if (!token) {
      setStaff(null)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setStaff(data.staff)
      } else {
        clearSession()
      }
    } catch {
      setStaff(null)
    } finally {
      setLoading(false)
    }
  }, [clearSession])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  useEffect(() => {
    const onSessionChanged = () => {
      const token = getToken()
      if (!token) {
        setStaff(null)
        setLoading(false)
      }
    }
    window.addEventListener(SESSION_EVENT, onSessionChanged)
    return () => window.removeEventListener(SESSION_EVENT, onSessionChanged)
  }, [])

  useEffect(() => {
    const expiresAt = getStoredTokenExpiry()
    if (!staff || !expiresAt) return
    const remainingMs = Date.parse(expiresAt) - Date.now()
    if (remainingMs <= 0) {
      clearSession()
      return
    }
    const timer = window.setTimeout(() => {
      clearSession()
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [staff, clearSession])

  const login = useCallback(async (name) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Login failed')
    setStoredSession({
      token: data.token,
      staffName: data.staff?.name || '',
      expiresAt: data.expiresAt || null,
    })
    setStaff(data.staff)
  }, [])

  const logout = useCallback(async ({ skipServer = false } = {}) => {
    const token = getToken()
    if (token && !skipServer) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        // ignore network errors; still clear local session
      }
    }
    clearSession()
  }, [clearSession])

  const value = { staff, loading, login, logout, fetchMe, getToken }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
