import { PageHeader, EmptyState, Card, Button } from '@/components/ui'
import { ShieldCheck } from 'lucide-react'

export const metadata = {
  title: 'Admin',
  description: 'Administrator tools.',
}

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Admin"
        subtitle="User and project administration tools."
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <ShieldCheck className="h-6 w-6 text-[var(--orange-deep)]" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--ink)]">User management</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Add, remove, and role-assign users. Still being built.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <ShieldCheck className="h-6 w-6 text-[var(--orange-deep)]" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--ink)]">Project settings</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Environment, integrations, and secrets. Still being built.
              </p>
            </div>
          </div>
        </Card>
      </div>
      <EmptyState
        title="Admin tools are coming"
        detail="Admin pages are still in progress and currently require the admin role. This route now exists."
      />
    </div>
  )
}
