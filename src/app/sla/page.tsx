import { PageHeader, EmptyState, StatCard } from '@/components/ui'

export const metadata = {
  title: 'SLA Monitor',
  description: 'SLA and deadline monitoring.',
}

export default function SlaPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="SLA Monitor"
        subtitle="Watch approaching deadlines, overdue cases, and escalation candidates."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="On track" value="—" hint="No live data yet" />
        <StatCard label="Approaching" value="—" hint="No live data yet" tone="alert" />
        <StatCard label="Overdue" value="—" hint="No live data yet" tone="alert" />
        <StatCard label="Escalation" value="—" hint="No live data yet" tone="alert" />
      </div>
      <EmptyState
        title="SLA monitor is coming"
        detail="The attention-state engine is still being wired. Stats will populate from the database once the environment is configured."
      />
    </div>
  )
}
