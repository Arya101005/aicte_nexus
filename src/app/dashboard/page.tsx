import { PageHeader, EmptyState } from '@/components/ui'
import { OrbitNodes } from '@/components/surreal'

export const metadata = {
  title: 'Dashboard',
  description: 'AICTE Nexus overview.',
}

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Dashboard"
        subtitle="Overview of institutions, complaints, and SLA status."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="brutal-card p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Coming soon
            </h2>
            <p className="text-sm text-[var(--ink)]">
              This view is being built out. Subscribe to the repository if you want to
              follow when the dashboard widgets land.
            </p>
          </div>
        </div>
        <div className="brutal-card p-6">
          <OrbitNodes className="h-48 w-full" />
        </div>
      </div>
      <EmptyState
        title="Nothing to show yet"
        detail="The underlying data pages are still being wired up. The shell, search, and login are live."
      />
    </div>
  )
}
