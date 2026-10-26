import { PageHeader, EmptyState, Button } from '@/components/ui'

export const metadata = {
  title: 'Import',
  description: 'Import complaints from CSV or JSON.',
}

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Import"
        subtitle="Upload complaint data from CSV or JSON, review validation errors, and confirm the import."
      />
      <div className="brutal-card p-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Import is coming
        </h2>
        <p className="text-sm text-[var(--ink)]">
          The import flow is still being built. When it lands it will support:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-[var(--ink)]">
          <li className="flex items-start gap-2">
            <span className="shrink-0">•</span>
            <span>CSV and JSON uploads with size and row limits</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0">•</span>
            <span>Per-row validation with field-level errors</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0">•</span>
            <span>Idempotent upserts so re-imports are safe</span>
          </li>
        </ul>
      </div>
      <EmptyState
        title="Import is coming"
        detail="The upload, validation, and confirmation screens are still in progress. This route now exists."
      />
    </div>
  )
}
