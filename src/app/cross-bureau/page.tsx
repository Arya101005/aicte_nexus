import { PageHeader, EmptyState } from '@/components/ui'
import { FloatingFiles } from '@/components/surreal'

export const metadata = {
  title: 'Cross-Bureau',
  description: 'Cross-bureau cases and relationships.',
}

export default function CrossBureauPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Cross-Bureau"
        subtitle="Cases that touch more than one bureau or institution."
      />
      <div className="brutal-card overflow-hidden p-0">
        <FloatingFiles className="w-full max-w-2xl mx-auto" />
      </div>
      <EmptyState
        title="Cross-bureau review is coming"
        detail="The cross-bureau map and relationship view are still being built. This route now exists."
      />
    </div>
  )
}
