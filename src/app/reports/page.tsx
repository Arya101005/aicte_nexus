import { PageHeader, EmptyState } from '@/components/ui'
import { FloatingFiles } from '@/components/surreal'

export const metadata = {
  title: 'Reports',
  description: 'Generated reports and exports.',
}

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Reports"
        subtitle="Complaint summaries, SLA reports, and exportable views."
      />
      <div className="brutal-card overflow-hidden p-0">
        <FloatingFiles className="w-full max-w-2xl mx-auto" />
      </div>
      <EmptyState
        title="Reports are coming"
        detail="Report definitions and export flows are still being built. This route now exists."
      />
    </div>
  )
}
