import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_PADDING = 16
const INITIAL_DRAG = { x: 0, y: 0 }

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
  const cardRef = useRef(null)
  const pointerIdRef = useRef(null)

  const [isDragging, setIsDragging] = useState(false)
  const [offsetsByStep, setOffsetsByStep] = useState({})
  const [dragOffset, setDragOffset] = useState(INITIAL_DRAG)
  const [dragStart, setDragStart] = useState({
    pointerX: 0,
    pointerY: 0,
    originX: 0,
    originY: 0,
  })

  const placementClass =
    placement === 'bottom-left'
      ? 'items-end justify-start'
      : placement === 'top-left'
      ? 'items-start justify-start'
      : placement === 'top-right'
      ? 'items-start justify-end'
      : 'items-end justify-end'

  const clampOffset = useCallback((candidateOffset, currentOffset = dragOffset) => {
    const cardEl = cardRef.current
    if (!cardEl) return candidateOffset

    const rect = cardEl.getBoundingClientRect()
    const baseLeft = rect.left - currentOffset.x
    const baseTop = rect.top - currentOffset.y

    const minX = VIEWPORT_PADDING - baseLeft
    const maxX = window.innerWidth - VIEWPORT_PADDING - rect.width - baseLeft
    const minY = VIEWPORT_PADDING - baseTop
    const maxY = window.innerHeight - VIEWPORT_PADDING - rect.height - baseTop

    return {
      x: Math.min(Math.max(candidateOffset.x, minX), maxX),
      y: Math.min(Math.max(candidateOffset.y, minY), maxY),
    }
  }, [dragOffset])

  const setCurrentStepOffset = useCallback((nextOffsetOrUpdater) => {
    setDragOffset((prevOffset) => {
      const nextOffset =
        typeof nextOffsetOrUpdater === 'function'
          ? nextOffsetOrUpdater(prevOffset)
          : nextOffsetOrUpdater

      setOffsetsByStep((prev) => ({
        ...prev,
        [stepIndex]: nextOffset,
      }))

      return nextOffset
    })
  }, [stepIndex])

  const stopDragging = useCallback(() => {
    setIsDragging(false)
    pointerIdRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return
    setDragOffset(offsetsByStep[stepIndex] ?? INITIAL_DRAG)
  }, [offsetsByStep, open, stepIndex])

  useEffect(() => {
    if (!open || !isDragging) return undefined

    const handlePointerMove = (event) => {
      if (event.pointerId !== pointerIdRef.current) return

      const deltaX = event.clientX - dragStart.pointerX
      const deltaY = event.clientY - dragStart.pointerY
      const candidateOffset = {
        x: dragStart.originX + deltaX,
        y: dragStart.originY + deltaY,
      }

      setCurrentStepOffset((prevOffset) => clampOffset(candidateOffset, prevOffset))
    }

    const handlePointerEnd = (event) => {
      if (event.pointerId !== pointerIdRef.current) return
      stopDragging()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [clampOffset, dragStart.originX, dragStart.originY, dragStart.pointerX, dragStart.pointerY, isDragging, open, setCurrentStepOffset, stopDragging])

  useEffect(() => {
    if (!open) {
      stopDragging()
    }
  }, [open, stopDragging])

  useEffect(() => {
    if (!open || !cardRef.current) return

    setCurrentStepOffset((prevOffset) => clampOffset(prevOffset, prevOffset))
  }, [clampOffset, open, setCurrentStepOffset])

  useEffect(() => {
    if (!open) return undefined

    const handleResize = () => {
      setCurrentStepOffset((prevOffset) => clampOffset(prevOffset, prevOffset))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampOffset, open, setCurrentStepOffset])

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0) return

    pointerIdRef.current = event.pointerId
    setDragStart({
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    })

    setIsDragging(true)
  }, [dragOffset.x, dragOffset.y])

  const handleResetPosition = useCallback(() => {
    setCurrentStepOffset(INITIAL_DRAG)
  }, [setCurrentStepOffset])

  const handleDragKeyDown = useCallback((event) => {
    const distance = event.shiftKey ? 20 : 10
    let nextOffset = null

    if (event.key === 'ArrowLeft') {
      nextOffset = { x: dragOffset.x - distance, y: dragOffset.y }
    } else if (event.key === 'ArrowRight') {
      nextOffset = { x: dragOffset.x + distance, y: dragOffset.y }
    } else if (event.key === 'ArrowUp') {
      nextOffset = { x: dragOffset.x, y: dragOffset.y - distance }
    } else if (event.key === 'ArrowDown') {
      nextOffset = { x: dragOffset.x, y: dragOffset.y + distance }
    } else if (event.key === 'Escape') {
      nextOffset = INITIAL_DRAG
    }

    if (!nextOffset) return

    event.preventDefault()
    setCurrentStepOffset((prevOffset) => clampOffset(nextOffset, prevOffset))
  }, [clampOffset, dragOffset.x, dragOffset.y, setCurrentStepOffset])

  const cardStyle = useMemo(
    () => ({
      transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
      touchAction: 'none',
    }),
    [dragOffset.x, dragOffset.y]
  )

  if (!open || !step) return null

  return createPortal(
    <div className={`fixed inset-0 z-[10001] pointer-events-none flex p-4 ${placementClass}`}>
      <div
        ref={cardRef}
        style={cardStyle}
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden"
      >
        <div
          role="button"
          tabIndex={0}
          onPointerDown={handleDragStart}
          onKeyDown={handleDragKeyDown}
          aria-label="Drag interactive guide dialog"
          className={`px-4 py-3 border-b border-gray-200 cursor-grab select-none ${isDragging ? 'cursor-grabbing' : ''}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Interactive Guide</p>
              <h3 className="text-base font-semibold text-gray-900">{guideTitle}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Step {stepIndex + 1} of {totalSteps}
              </p>
            </div>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleResetPosition}
              className="mt-0.5 text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 cursor-pointer"
            >
              Reset position
            </button>
          </div>
        </div>
        <div className="px-4 py-3 space-y-2">
          <h4 className="text-sm font-semibold text-gray-900">{step.title}</h4>
          <p className="text-sm text-gray-700">{step.description}</p>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
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
