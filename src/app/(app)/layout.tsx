import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui";

/**
 * Unprotected app layout. Authentication has been removed for now;
 * every route is accessible without a login.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No session check here. The app shell is fully accessible.
  return (
    <ToastProvider>
      <AppShell profile={null} unread={0}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
