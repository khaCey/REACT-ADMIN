// npm start: hide WIP. npm run dev: show WIP. Production build: always hide.
// No need to change these until a feature is finished.
const _GUIDES_WIP_HIDDEN = false
const _NOTIFICATIONS_WIP_DISABLED = false

const forceHideWip = import.meta.env.PRODUCTION || import.meta.env.VITE_WIP_HIDDEN === 'true'
export const GUIDES_WIP_HIDDEN = forceHideWip ? true : _GUIDES_WIP_HIDDEN
export const NOTIFICATIONS_WIP_DISABLED = forceHideWip ? true : _NOTIFICATIONS_WIP_DISABLED

