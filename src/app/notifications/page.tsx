import { PageHeader, EmptyState } from '@/components/ui'
import { Bell } from 'lucide-react'

export const metadata = {
  title: 'Notifications',
  description: 'In-app notifications.',
}

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace"
        title="Notifications"
        subtitle="Recent alerts and updates for your account."
      />
      <div className="brutal-card flex flex-col items-center gap-3 p-8 text-center">
        <div className="w-16 opacity-80">
          <Bell className="h-8 w-8 text-[var(--orange-deep)]" aria-hidden="true" />
        </div>
        <p className="max-w-md text-sm text-[var(--muted)]">
          Notification delivery is still being built. When it lands you will see
          unread counts in the header and the full notification history here.
        </p>
      </div>
      <EmptyState
        title="Notifications are coming"
        detail="The notification list and read/unread toggles are still in progress. This route now exists."
      />
    </div>
  )
}
