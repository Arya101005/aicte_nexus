import { PageHeader, EmptyState, StatCard } from '@/components/ui'

export const metadata = {
  title: 'Data Health',
  description: 'Data quality and import health.',
}

export default function DataHealthPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Data Health"
        subtitle="Import outcomes, missing fields, and data-quality signals."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Records" value="—" hint="No live data yet" />
        <StatCard label="Import errors" value="—" hint="No live data yet" tone="alert" />
        <StatCard label="Duplicates flagged" value="—" hint="No live data yet" />
        <StatCard label="Orphan references" value="—" hint="No live data yet" tone="alert" />
      </div>
      <EmptyState
        title="Data health is coming"
        detail="Import telemetry and integrity checks are still being built. This route now exists."
      />
    </div>
  )
}
