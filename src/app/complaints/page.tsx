import { PageHeader, EmptyState } from '@/components/ui'
import { StairsToNowhere } from '@/components/surreal'

export const metadata = {
  title: 'Complaints',
  description: 'Browse and manage complaints.',
}

export default function ComplaintsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Complaints"
        subtitle="View and work through complaints across bureaus and institutions."
      />
      <div className="brutal-card flex flex-col items-center gap-3 p-8 text-center">
        <div className="w-44 opacity-90">
          <StairsToNowhere />
        </div>
        <p className="max-w-md text-sm text-[var(--muted)]">
          The complaint worklist is still being built. Use Search to find specific
          references in the meantime.
        </p>
      </div>
      <EmptyState
        title="Complaint list is coming"
        detail="Filters, status workflow, and assignment controls are still in progress. This route now exists."
      />
    </div>
  )
}
