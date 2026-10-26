import { PageHeader, EmptyState } from '@/components/ui'
import { FloatingFiles } from '@/components/surreal'

export const metadata = {
  title: 'Institutions',
  description: 'Manage institutions.',
}

export default function InstitutionsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Institutions"
        subtitle="Browse and manage institutions across bureaus."
      />
      <div className="brutal-card overflow-hidden p-0">
        <FloatingFiles className="w-full max-w-2xl mx-auto" />
      </div>
      <EmptyState
        title="Institution list is coming"
        detail="The institution browser and detail pages are still being built. This route now exists and will render once they land."
      />
    </div>
  )
}
