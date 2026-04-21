// npm start: hide WIP. npm run dev: show WIP. Production build: always hide.
// No need to change these until a feature is finished.
// true = hide all interactive guides in dev too (whitelist empty below also disables every slug).
const _GUIDES_WIP_HIDDEN = true
const _NOTIFICATIONS_WIP_DISABLED = false

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

// Keep notifications flag separate from guides so notification behavior is independent.
export const NOTIFICATIONS_WIP_DISABLED = _NOTIFICATIONS_WIP_DISABLED

