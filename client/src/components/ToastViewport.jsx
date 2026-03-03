import { CheckCircle2, X } from 'lucide-react'

export default function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[12000] flex flex-col gap-2 w-[22rem] max-w-[92vw] pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-xl border border-emerald-200 bg-white shadow-lg overflow-hidden"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3 p-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-800 flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-gray-400 hover:text-gray-600 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
