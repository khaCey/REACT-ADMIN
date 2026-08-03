// npm start: hide WIP. npm run dev: show WIP. Production build: always hide.
// No need to change these until a feature is finished.
// true = hide all interactive guides in dev too (whitelist empty below also disables every slug).
const _GUIDES_WIP_HIDDEN = true
/** When true, hide notification UI (bell, sidebar link, /notifications, post-login unread, polling). */
const _NOTIFICATIONS_WIP_DISABLED = true
/** When true, hide Messages (sidebar link, /messages) and skip deep-links from notifications. */
const _MESSAGES_WIP_DISABLED = true
/** When true, grey out + strikethrough booking CTAs and block the booking calendar. */
const _BOOKING_WIP_DISABLED = false
/** When true, grey out Confirm one / Confirm all for 固定 (reserved) lessons. */
const _RESERVED_CONFIRM_WIP_DISABLED = true

// When set, only these guide slugs are enabled. Enables them even in production.
// Use null to allow all guides (subject to GUIDES_WIP_HIDDEN).
// Use [] to hide every guide (no walkthroughs, no "Start guide" UI).
export const ENABLED_GUIDE_SLUGS = []

const forceHideWip = import.meta.env.PRODUCTION || import.meta.env.VITE_WIP_HIDDEN === 'true'
export const GUIDES_WIP_HIDDEN = forceHideWip ? true : _GUIDES_WIP_HIDDEN

export function isGuideEnabled(slug) {
  if (!slug) return false
  if (Array.isArray(ENABLED_GUIDE_SLUGS) && ENABLED_GUIDE_SLUGS.length === 0) return false
  if (ENABLED_GUIDE_SLUGS?.length) return ENABLED_GUIDE_SLUGS.includes(slug)
  return !GUIDES_WIP_HIDDEN
}

/** When false, hide walkthrough UI (e.g. "Start guide") — matches isGuideEnabled for any slug. */
export function areGuidesAvailable() {
  if (Array.isArray(ENABLED_GUIDE_SLUGS) && ENABLED_GUIDE_SLUGS.length === 0) return false
  if (ENABLED_GUIDE_SLUGS?.length) return true
  return !GUIDES_WIP_HIDDEN
}

// Optional: VITE_NOTIFICATIONS_ENABLED=true in client/.env re-enables notifications (restart Vite).
const forceEnableNotifications = import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true'
export const NOTIFICATIONS_WIP_DISABLED = forceEnableNotifications ? false : _NOTIFICATIONS_WIP_DISABLED

// Optional: VITE_MESSAGES_ENABLED=true in client/.env re-enables Messages (restart Vite).
const forceEnableMessages = import.meta.env.VITE_MESSAGES_ENABLED === 'true'
export const MESSAGES_WIP_DISABLED = forceEnableMessages ? false : _MESSAGES_WIP_DISABLED

// Optional: VITE_BOOKING_ENABLED=true in client/.env re-enables booking (restart Vite).
const forceEnableBooking = import.meta.env.VITE_BOOKING_ENABLED === 'true'
export const BOOKING_WIP_DISABLED = forceEnableBooking ? false : _BOOKING_WIP_DISABLED

// Optional: VITE_RESERVED_CONFIRM_ENABLED=true in client/.env re-enables 固定 confirm (restart Vite).
const forceEnableReservedConfirm = import.meta.env.VITE_RESERVED_CONFIRM_ENABLED === 'true'
export const RESERVED_CONFIRM_WIP_DISABLED = forceEnableReservedConfirm
  ? false
  : _RESERVED_CONFIRM_WIP_DISABLED

