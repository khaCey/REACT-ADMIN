import LoadingSpinner from './LoadingSpinner'

/**
 * Covers the entire modal panel (parent must be `position: relative`).
 * Use until every in-modal fetch/action for that view has finished.
 */
export default function ModalLoadingOverlay({ className = '' }) {
  return (
    <div
      className={`absolute inset-0 z-[100] flex items-center justify-center bg-white ${className}`.trim()}
      aria-busy="true"
      aria-live="polite"
    >
      <LoadingSpinner size="md" />
    </div>
  )
}
