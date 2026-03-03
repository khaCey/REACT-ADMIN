/**
 * Auth context - staff login for shift start
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

const TOKEN_KEY = 'staff_token'
const STAFF_KEY = 'staff_name'

export function useAuth() {
  const ctx = useContext(AuthContext)
  return ctx ?? { staff: null, loading: true, login: async () => {}, logout: () => {}, setStaff: () => {} }
}

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(null)
  const [loading, setLoading] = useState(true)

  const getToken = () => localStorage.getItem(TOKEN_KEY)

  const fetchMe = useCallback(async () => {
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
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(STAFF_KEY)
        setStaff(null)
      }
    } catch {
      setStaff(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  const login = useCallback(async (name) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Login failed')
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(STAFF_KEY, data.staff?.name || '')
    setStaff(data.staff)
  }, [])

  const logout = useCallback(async () => {
    const token = getToken()
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        // ignore network errors; still clear local session
      }
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(STAFF_KEY)
    setStaff(null)
  }, [])

  const value = { staff, loading, login, logout, fetchMe, getToken }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
