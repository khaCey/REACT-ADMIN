import { CalendarDays, GraduationCap, Presentation, Users } from 'lucide-react'

function StatCard({ icon: Icon, iconClassName, iconWrapClassName, label, value, detail, compact = false }) {
  return (
    <article className={`rounded-xl border border-gray-200 bg-white shadow-sm ${compact ? 'min-h-[78px] p-2.5 sm:p-3 xl:p-2.5' : 'p-4'}`}>
      <div className={`flex items-start justify-between ${compact ? 'gap-1.5' : 'gap-3'}`}>
        <div className="min-w-0">
          <p className={`font-medium text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>{label}</p>
          <p className={`font-bold tracking-tight text-gray-900 ${compact ? 'mt-0.5 text-xl xl:text-2xl' : 'mt-1 text-2xl'}`}>
            {value == null ? '—' : value}
          </p>
          <p className={`text-gray-500 ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs'}`}>{detail}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${iconWrapClassName}`}>
          <Icon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} ${iconClassName}`} />
        </span>
      </div>
    </article>
  )
}

export default function DashboardStats({
  compact = false,
  todayLessons,
  activeStudents,
  lessonsThisMonth,
  demoLessons,
}) {
  const cards = [
    {
      label: "Today's Lessons",
      value: todayLessons,
      detail: 'Scheduled today',
      icon: CalendarDays,
      iconWrapClassName: 'bg-green-100',
      iconClassName: 'text-green-700',
    },
    {
      label: 'Active Students',
      value: activeStudents,
      detail: 'Current active records',
      icon: Users,
      iconWrapClassName: 'bg-emerald-100',
      iconClassName: 'text-emerald-700',
    },
    {
      label: 'Lessons This Month',
      value: lessonsThisMonth,
      detail: 'Regular lessons',
      icon: GraduationCap,
      iconWrapClassName: 'bg-violet-100',
      iconClassName: 'text-violet-700',
    },
    {
      label: 'Demo Lessons',
      value: demoLessons,
      detail: 'This month',
      icon: Presentation,
      iconWrapClassName: 'bg-amber-100',
      iconClassName: 'text-amber-700',
    },
  ]

  return (
    <section
      className={compact
        ? 'grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2 xl:gap-2.5'
        : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'}
      aria-label="Dashboard summary"
    >
      {cards.map((card) => (
        <StatCard key={card.label} {...card} compact={compact} />
      ))}
    </section>
  )
}
