import { BookOpen, ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useGuideTour } from '../context/GuideTourContext'
import { areGuidesAvailable, isGuideEnabled } from '../guides/wipFlags'

const GUIDE_ROUTES = [
  { path: '/guides/students', slug: 'guide.students', title: 'Students guide' },
  { path: '/guides/payments', slug: 'guide.payments', title: 'Payments guide' },
  { path: '/guides/notes', slug: 'guide.notes', title: 'Notes guide' },
  { path: '/guides/notifications', slug: 'guide.notifications', title: 'Notifications guide' },
  { path: '/guides/change-history', slug: 'guide.change-history', title: 'Change history guide' },
]

export function GuidesLauncherPage({ slug }) {
  const location = useLocation()
  const { startGuideBySlug } = useGuideTour()
  const hasStartedRef = useRef(false)
  const guideConfig = GUIDE_ROUTES.find((entry) => entry.slug === slug)
  const enabled = isGuideEnabled(slug)

  useEffect(() => {
    if (!slug || hasStartedRef.current || !enabled) return
    hasStartedRef.current = true
    startGuideBySlug(slug)
  }, [slug, enabled, startGuideBySlug])

  if (!guideConfig) {
    return (
      <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-auto">
        <h1 className="text-xl font-semibold text-gray-900">Guide not found</h1>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-auto">
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="w-5 h-5 text-green-700" />
        <h1 className="text-xl font-semibold text-gray-900">{guideConfig.title}</h1>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        {enabled
          ? 'This route launches the existing walkthrough modal. Use replay controls in the modal to continue.'
          : 'This guide is currently hidden by WIP flags.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => startGuideBySlug(slug)}
          disabled={!enabled}
          className="px-4 py-2 rounded bg-green-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
        >
          Start walkthrough
        </button>
        <Link to="/guides" className="text-sm text-green-700 hover:text-green-900">
          Back to guides list
        </Link>
      </div>
      {location.pathname !== '/guides' && (
        <p className="mt-4 text-xs text-gray-500">Route: {location.pathname}</p>
      )}
    </div>
  )
}

export default function Guides() {
  const guidesOn = areGuidesAvailable()
  const availableGuides = GUIDE_ROUTES.filter((entry) => isGuideEnabled(entry.slug))

  return (
    <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-5 h-5 text-green-700" />
        <h1 className="text-xl font-semibold text-gray-900">Guides</h1>
      </div>
      <p className="text-sm text-gray-600 mb-5">
        Open a guide page to launch the existing walkthrough from a dedicated entry point.
      </p>
      {!guidesOn && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Guides are currently disabled by WIP configuration.
        </div>
      )}
      <ul className="space-y-2">
        {GUIDE_ROUTES.map((entry) => {
          const enabled = availableGuides.some((guide) => guide.slug === entry.slug)
          return (
            <li key={entry.path}>
              <Link
                to={entry.path}
                className={`flex items-center justify-between rounded border px-4 py-3 transition-colors ${
                  enabled
                    ? 'border-gray-200 hover:border-green-500 hover:bg-green-50 text-gray-900'
                    : 'border-gray-200 bg-gray-50 text-gray-500 pointer-events-none'
                }`}
              >
                <span className="font-medium">{entry.title}</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
