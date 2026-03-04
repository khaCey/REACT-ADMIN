import { createPortal } from 'react-dom'

export default function GuideWalkthroughModal({
  open,
  guideTitle,
  step,
  stepIndex,
  totalSteps,
  onPrev,
  onNext,
  onReplayStep,
  onClose,
  placement = 'bottom-right',
}) {
  if (!open || !step) return null

  const placementClass =
    placement === 'bottom-left'
      ? 'items-end justify-start'
      : placement === 'top-left'
      ? 'items-start justify-start'
      : placement === 'top-right'
      ? 'items-start justify-end'
      : 'items-end justify-end'

  return createPortal(
    <div className={`fixed inset-0 z-[10001] pointer-events-none flex p-4 ${placementClass}`}>
      <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Interactive Guide</p>
          <h3 className="text-base font-semibold text-gray-900">{guideTitle}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Step {stepIndex + 1} of {totalSteps}
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <h4 className="text-sm font-semibold text-gray-900">{step.title}</h4>
          <p className="text-sm text-gray-700">{step.description}</p>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={stepIndex <= 0}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 disabled:opacity-50 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={onReplayStep}
              className="px-3 py-1.5 rounded-lg border border-indigo-300 text-sm text-indigo-700 hover:bg-indigo-50 cursor-pointer"
            >
              Re-open step
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
            >
              End guide
            </button>
            <button
              type="button"
              onClick={onNext}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-sm text-white hover:bg-green-700 cursor-pointer"
            >
              {stepIndex + 1 >= totalSteps ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
