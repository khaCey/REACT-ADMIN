import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Secondary student admin actions (opened from the footer settings gear).
 */
export default function StudentSettingsModal({
  studentName,
  syncingGoogleContact = false,
  showManageGroup = false,
  showMarkHiatus = false,
  onSyncGoogleContact,
  onManageGroup,
  onMarkHiatus,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !syncingGoogleContact) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, syncingGoogleContact])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !syncingGoogleContact) onClose()
  }

  const runAndClose = (fn) => {
    if (typeof fn !== 'function') return
    fn()
    onClose()
  }

  const runSyncGoogleContact = async () => {
    if (typeof onSyncGoogleContact !== 'function' || syncingGoogleContact) return
    await onSyncGoogleContact()
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-gray-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-settings-title"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h2 id="student-settings-title" className="text-base font-semibold text-gray-900">
              Student settings
            </h2>
            {studentName ? (
              <p className="text-xs text-gray-500 truncate mt-0.5">{studentName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={syncingGoogleContact}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={runSyncGoogleContact}
            disabled={syncingGoogleContact}
            className={`w-full inline-flex items-center justify-center rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white ${
              syncingGoogleContact ? 'opacity-70 cursor-not-allowed' : 'hover:bg-green-700 cursor-pointer'
            }`}
          >
            {syncingGoogleContact ? 'Syncing…' : 'Sync Google Contact'}
          </button>
          {showManageGroup && (
            <button
              type="button"
              onClick={() => runAndClose(onManageGroup)}
              className="w-full inline-flex items-center justify-center rounded-lg border border-purple-600 bg-white px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 cursor-pointer"
            >
              Manage Group Members
            </button>
          )}
          {showMarkHiatus && (
            <button
              type="button"
              onClick={() => runAndClose(onMarkHiatus)}
              className="w-full inline-flex items-center justify-center rounded-lg border border-green-600 bg-white px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 cursor-pointer"
            >
              Mark on break (休会中)
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
