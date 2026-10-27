"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  FileText,
  Share2,
  CopyCheck,
  Timer,
  HeartPulse,
  BarChart3,
  Upload,
  Bell,
  ShieldCheck,
  Search,
  Menu,
  X,
} from "lucide-react";
import { NotificationBell } from "@/components/ui";

type Profile = null;

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/institutions", label: "Institutions", icon: Building2 },
  { href: "/complaints", label: "Complaints", icon: FileText },
  { href: "/cross-bureau", label: "Cross-Bureau", icon: Share2 },
  { href: "/duplicates", label: "Duplicate Review", icon: CopyCheck },
  { href: "/sla", label: "SLA Monitor", icon: Timer },
  { href: "/data-health", label: "Data Health", icon: HeartPulse },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];



function NavList({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <a
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[44px] items-center gap-3 rounded-[4px] border-2 px-3 py-2 text-sm font-semibold transition-colors ${
              active
                ? "border-[var(--ink)] bg-[var(--orange)] text-[var(--ink)] shadow-[3px_3px_0_var(--ink)]"
                : "border-transparent text-[var(--ink)] hover:border-[var(--line)] hover:bg-[var(--peach)]"
            }`}
          >
            <Icon aria-hidden="true" size={17} />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export function AppShell({
  profile,
  unread,
  children,
}: {
  profile: null;
  unread: number;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  const items = NAV_ITEMS.filter(() => true);

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get("q");
    const query = typeof q === "string" ? q.trim() : "";
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <a href="/dashboard" className="flex items-baseline gap-2 px-1">
        <span className="font-[var(--font-space-grotesk)] text-xl font-bold tracking-tight text-[var(--ink)]">
          NEXUS
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--orange-deep)]">
          AICTE
        </span>
      </a>

      <NavList items={items} onNavigate={() => setDrawerOpen(false)} />

      <div className="mt-auto border-t-2 border-[var(--line)] pt-4">
        <p className="truncate text-sm font-semibold text-[var(--ink)]">
          AICTE Nexus
        </p>
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Demo data is synthetic and labelled. Not for official use.
        </p>

        <p className="mt-3 text-[10px] leading-relaxed text-[var(--muted)]">
          Demo data is synthetic and labelled. Not for official use.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r-2 border-[var(--ink)] bg-[var(--surface)] lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] lg:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <aside className="h-full w-64 border-r-2 border-[var(--ink)] bg-[var(--surface)]">
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--ink)] bg-[var(--surface)]"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--ink)] bg-[var(--paper)] px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--ink)] bg-[var(--surface)] lg:hidden"
          >
            <Menu aria-hidden="true" size={18} />
          </button>

          <form onSubmit={onSearch} role="search" className="min-w-0 flex-1 max-w-md">
            <label htmlFor="global-search" className="sr-only">
              Search institutions and complaints
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search institutions, references…"
                className="brutal-input pl-9"
              />
            </div>
          </form>

          <div className="ml-auto flex items-center gap-3">
            <NotificationBell unread={unread} href="/notifications" />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>

        <footer className="border-t-2 border-[var(--line)] px-4 py-4 text-center text-xs text-[var(--muted)] sm:px-6 lg:px-8">
          AICTE Nexus — SIH prototype. Synthetic demo data, labelled as such.
        </footer>
      </div>
    </div>
  );
}
