"use client";

import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--paper)] p-6">
      <div className="w-full max-w-md rounded-[6px] border-2 border-[var(--ink)] bg-[var(--surface)] p-8 text-center shadow-[4px_4px_0_var(--ink)]">
        <div className="mb-6">
          <h1 className="font-[var(--font-display)] text-3xl font-bold tracking-tight text-[var(--ink)]">
            AICTE Nexus
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Integrated Institution Complaint Monitoring and Status Dashboard.
          </p>
        </div>

        <div className="mb-6 rounded-[4px] border-2 border-[var(--line)] p-4 text-xs text-[var(--muted)]">
          Authentication has been removed. You can now access all pages directly.
        </div>

        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 rounded-[4px] border-2 border-[var(--orange)] bg-[var(--orange)] px-5 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--orange-deep)] transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    </main>
  );
}
