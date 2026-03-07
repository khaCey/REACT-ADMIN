// npm start: hide WIP. npm run dev: show WIP. Production build: always hide.
// No need to change these until a feature is finished.
const _GUIDES_WIP_HIDDEN = false
const _NOTIFICATIONS_WIP_DISABLED = false

// When set, only these guide slugs are enabled. Enables them even in production.
// Use null or [] to allow all guides (subject to GUIDES_WIP_HIDDEN).
export const ENABLED_GUIDE_SLUGS = []

const forceHideWip = import.meta.env.PRODUCTION || import.meta.env.VITE_WIP_HIDDEN === 'true'
export const GUIDES_WIP_HIDDEN = forceHideWip ? true : _GUIDES_WIP_HIDDEN

export function isGuideEnabled(slug) {
  if (!slug) return false
  if (Array.isArray(ENABLED_GUIDE_SLUGS) && ENABLED_GUIDE_SLUGS.length === 0) return false
  if (ENABLED_GUIDE_SLUGS?.length) return ENABLED_GUIDE_SLUGS.includes(slug)
  return !GUIDES_WIP_HIDDEN
}

// When guides are enabled, keep notifications visible so staff can access guide notifications.
const _notificationsDisabled = forceHideWip ? true : _NOTIFICATIONS_WIP_DISABLED
export const NOTIFICATIONS_WIP_DISABLED =
  ENABLED_GUIDE_SLUGS?.length ? false : _notificationsDisabled

