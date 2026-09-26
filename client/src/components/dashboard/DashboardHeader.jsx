import { Calendar, LayoutDashboard } from 'lucide-react'

export default function DashboardHeader({ dateLabel, onOpenCalendar }) {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 pt-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Here&apos;s what&apos;s happening at Green Square today.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {dateLabel && (
          <span className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm">
            <Calendar className="h-4 w-4 text-green-600" />
            {dateLabel}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenCalendar}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
        >
          <Calendar className="h-4 w-4" />
          Calendar Events
        </button>
      </div>
    </div>
  )
}
