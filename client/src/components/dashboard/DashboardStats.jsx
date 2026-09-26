import { CalendarDays, GraduationCap, Presentation, Users } from 'lucide-react'

function StatCard({ icon: Icon, iconClassName, iconWrapClassName, label, value, detail }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
            {value == null ? '—' : value}
          </p>
          <p className="mt-1 text-xs text-gray-500">{detail}</p>
        </div>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconWrapClassName}`}>
          <Icon className={`h-5 w-5 ${iconClassName}`} />
        </span>
      </div>
    </article>
  )
}

export default function DashboardStats({
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
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Dashboard summary">
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </section>
  )
}
