import LoadingSpinner from './LoadingSpinner'

/** Same full-viewport overlay as the Students list (initial load). */
export default function FullPageLoading() {
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-gray-100">
      <LoadingSpinner size="md" />
    </div>
  )
}
