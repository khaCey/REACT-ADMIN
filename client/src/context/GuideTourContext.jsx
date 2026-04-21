import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import GuideWalkthroughModal from '../components/GuideWalkthroughModal'
import { getGuideBySlug } from '../guides/guideDefinitions'
import { areGuidesAvailable, isGuideEnabled } from '../guides/wipFlags'

const GuideTourContext = createContext(null)

export function useGuideTour() {
  const ctx = useContext(GuideTourContext)
  return ctx ?? {
    activeGuideSlug: null,
    startGuideBySlug: () => false,
    endGuide: () => {},
    replayCurrentStep: () => {},
  }
}

export function GuideTourProvider({ children }) {
  const navigate = useNavigate()
  const [activeGuideSlug, setActiveGuideSlug] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [runNonce, setRunNonce] = useState(0)

  const activeGuide = activeGuideSlug ? getGuideBySlug(activeGuideSlug) : null
  const activeStep = activeGuide?.steps?.[stepIndex] || null
  const walkthroughPlacement =
    activeStep?.tooltip?.placement || activeStep?.target?.placement || 'bottom-right'

  const endGuide = useCallback(() => {
    setActiveGuideSlug(null)
    setStepIndex(0)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('guide:ended'))
    }
  }, [])

  const guidesOn = areGuidesAvailable()
  useEffect(() => {
    if (!guidesOn && activeGuideSlug) endGuide()
  }, [guidesOn, activeGuideSlug, endGuide])

  const startGuideBySlug = useCallback((slug) => {
    if (!isGuideEnabled(slug)) return false
    const guide = getGuideBySlug(slug)
    if (!guide) return false
    setActiveGuideSlug(slug)
    setStepIndex(0)
    setRunNonce(Date.now())
    return true
  }, [])

  const replayCurrentStep = useCallback(() => {
    setRunNonce(Date.now())
  }, [])

  const nextStep = useCallback(() => {
    if (!activeGuide) return
    if (stepIndex + 1 >= activeGuide.steps.length) {
      endGuide()
      return
    }
    setStepIndex((i) => i + 1)
    setRunNonce(Date.now())
  }, [activeGuide, stepIndex, endGuide])

  const prevStep = useCallback(() => {
    if (!activeGuide) return
    setStepIndex((i) => Math.max(0, i - 1))
    setRunNonce(Date.now())
  }, [activeGuide])

  useEffect(() => {
    if (!activeGuideSlug || !isGuideEnabled(activeGuideSlug)) return
    if (!activeStep?.route) return
    navigate(activeStep.route, {
      state: {
        guideAction: activeStep?.completion?.payload?.action || null,
        guideNonce: runNonce || Date.now(),
      },
    })
  }, [activeStep, runNonce, navigate])

  const value = useMemo(() => ({
    activeGuideSlug,
    activeStep,
    stepIndex,
    startGuideBySlug,
    endGuide,
    replayCurrentStep,
  }), [activeGuideSlug, activeStep, stepIndex, startGuideBySlug, endGuide, replayCurrentStep])

  return (
    <GuideTourContext.Provider value={value}>
      {children}
      {activeGuide && isGuideEnabled(activeGuideSlug) && (
        <GuideWalkthroughModal
          open={!!activeGuide}
          guideTitle={activeGuide?.title}
          step={activeStep}
          stepIndex={stepIndex}
          totalSteps={activeGuide?.steps?.length || 0}
          placement={walkthroughPlacement}
          onPrev={prevStep}
          onNext={nextStep}
          onReplayStep={replayCurrentStep}
          onClose={endGuide}
        />
      )}
    </GuideTourContext.Provider>
  )
}
