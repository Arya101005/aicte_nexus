import { PageHeader, EmptyState } from '@/components/ui'
import { StairsToNowhere } from '@/components/surreal'

export const metadata = {
  title: 'Duplicate Review',
  description: 'Review potential duplicate complaints.',
}

export default function DuplicatesPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Duplicate Review"
        subtitle="Review candidate duplicate and related-case pairs."
      />
      <div className="brutal-card flex flex-col items-center gap-3 p-8 text-center">
        <div className="w-44 opacity-90">
          <StairsToNowhere />
        </div>
        <p className="max-w-md text-sm text-[var(--muted)]">
          Duplicate classification runs against the database. This view is being
          built out; pairs will appear here once the data layer is wired.
        </p>
      </div>
      <EmptyState
        title="Duplicate review is coming"
        detail="The classifier and review queue are still in progress. This route now exists."
      />
    </div>
  )
}
