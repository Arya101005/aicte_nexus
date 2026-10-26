import { AppShell } from "@/components/app-shell";
import { ToastProvider, ErrorState } from "@/components/ui";
import { requireSession, ConfigMissingError, friendlyError } from "@/lib/session";

/**
 * Real, server-side authorization for every app route (§3 auth).
 * The proxy redirect is cosmetic; this is where the session is checked.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let unread = 0;
  let ctx: Awaited<ReturnType<typeof requireSession>>;

  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof ConfigMissingError) {
      return (
        <main className="mx-auto max-w-xl px-4 py-16">
          <ErrorState
            title="Not configured"
            detail={friendlyError(err)}
          />
        </main>
      );
    }
    throw err;
  }

  const { count } = await ctx.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  unread = count ?? 0;

  return (
    <ToastProvider>
      <AppShell profile={ctx.profile} unread={unread}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
