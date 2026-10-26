import { PageHeader, EmptyState, Button, Input } from '@/components/ui'

export const metadata = {
  title: 'Create account',
  description: 'Create an AICTE Nexus account.',
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--paper)] p-6">
      <div className="w-full max-w-md rounded-[6px] border-2 border-[var(--ink)] bg-[var(--surface)] p-8 shadow-[4px_4px_0_var(--ink)]">
        <div className="mb-6 flex items-center justify-between">
          <span className="font-[var(--font-display)] text-xl font-bold tracking-tight text-[var(--orange-deep)]">
            NEXUS
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--orange-deep)]">
            AICTE
          </span>
        </div>

        <PageHeader
          title="Create account"
          subtitle="Sign up for an AICTE Nexus account."
        />

        <form className="flex flex-col gap-4">
          <Input
            label="Full name"
            type="text"
            autoComplete="name"
            required
            placeholder="Priya Sharma"
          />
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.gov.in"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
          />
          <Button type="submit" className="mt-2 w-full">
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-[var(--muted)]">
          Already have an account?{' '}
          <a href="/login" className="underline hover:text-[var(--orange-deep)]">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
