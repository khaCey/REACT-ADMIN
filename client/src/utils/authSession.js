const TOKEN_KEY = 'staff_token'
const STAFF_KEY = 'staff_name'
const EXPIRES_AT_KEY = 'staff_token_expires_at'
const SESSION_EVENT = 'staff-session-changed'

function notifySessionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EVENT))
  }
}

function parseExpiresAt(value) {
  const iso = String(value || '').trim()
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function getStoredToken() {
  const expiresAt = getStoredTokenExpiry()
  if (!expiresAt) return localStorage.getItem(TOKEN_KEY)
  if (Date.now() >= Date.parse(expiresAt)) {
    clearStoredSession()
    return null
  }
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredTokenExpiry() {
  return parseExpiresAt(localStorage.getItem(EXPIRES_AT_KEY))
}

export function setStoredSession({ token, staffName, expiresAt }) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  if (staffName != null) localStorage.setItem(STAFF_KEY, staffName)
  const normalizedExpiry = parseExpiresAt(expiresAt)
  if (normalizedExpiry) {
    localStorage.setItem(EXPIRES_AT_KEY, normalizedExpiry)
  } else {
    localStorage.removeItem(EXPIRES_AT_KEY)
  }
  notifySessionChanged()
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(STAFF_KEY)
  localStorage.removeItem(EXPIRES_AT_KEY)
  notifySessionChanged()
}

export function isStoredSessionExpired() {
  const expiresAt = getStoredTokenExpiry()
  return !!expiresAt && Date.now() >= Date.parse(expiresAt)
}

export { TOKEN_KEY, STAFF_KEY, EXPIRES_AT_KEY, SESSION_EVENT }
