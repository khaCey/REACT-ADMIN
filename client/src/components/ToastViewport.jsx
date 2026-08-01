import { ArrowRight, CheckCircle2, X } from 'lucide-react'

export default function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="fixed top-20 right-4 z-[12000] flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => {
        const clickable = typeof toast.onClick === 'function'
        return (
          <div
            key={toast.id}
            className="pointer-events-auto relative overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-[0_16px_40px_-16px_rgba(15,118,110,0.45)]"
            role="status"
            aria-live="polite"
          >
            <span className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" aria-hidden />
            <div className="flex items-start gap-3.5 py-4 pl-5 pr-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-100">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </span>
              {clickable ? (
                <button
                  type="button"
                  className="group min-w-0 flex-1 cursor-pointer text-left"
                  onClick={() => {
                    try {
                      toast.onClick()
                    } finally {
                      onDismiss(toast.id)
                    }
                  }}
                >
                  <span className="block text-sm font-semibold leading-5 text-slate-900">
                    {toast.message}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1 text-sm font-medium text-emerald-700 transition-colors group-hover:text-emerald-800">
                    {toast.actionLabel || 'Open details'}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </button>
              ) : (
                <p className="min-w-0 flex-1 pt-0.5 text-sm font-medium leading-5 text-slate-800">{toast.message}</p>
              )}
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
