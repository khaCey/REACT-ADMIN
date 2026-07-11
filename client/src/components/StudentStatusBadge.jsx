/** Shared student status badge (Active / Dormant / 休会中 / DEMO). */
export default function StudentStatusBadge({ status }) {
  const normalized = status || 'Active'
  const cls =
    normalized === 'Active'
      ? 'badge-status-active'
      : normalized === 'Dormant'
        ? 'badge-status-dormant'
        : normalized === '休会中'
          ? 'badge-status-hiatus'
          : 'badge-status-demo'
  return <span className={`badge ${cls}`}>{normalized}</span>
}

export const HIATUS_STATUS = '休会中'
