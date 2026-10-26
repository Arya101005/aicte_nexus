"use client";

import {
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
  type InputHTMLAttributes,
  type ButtonHTMLAttributes,
  type SelectHTMLAttributes,
  type FormEvent,
} from "react";
import {
  Circle,
  PlayCircle,
  Info,
  CheckCircle2,
  Lock,
  Clock,
  TriangleAlert,
  Flame,
  Hourglass,
  X,
  Bell,
  Check,
  Search,
} from "lucide-react";
import { StairsToNowhere } from "@/components/surreal";

/* ------------------------------------------------------------------ */
/* SectionLabel — uppercase, letter-spaced, ink pill                    */
/* ------------------------------------------------------------------ */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded bg-[var(--ink)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--paper)]">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Button — neo-brutalist: 2px ink border, offset shadow, press-in      */
/* ------------------------------------------------------------------ */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] border-2 border-[var(--ink)] px-5 py-2.5 text-sm font-semibold transition-all duration-150 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--orange-deep)] disabled:cursor-not-allowed disabled:opacity-50";

  const variants: Record<string, string> = {
    primary:
      "bg-[var(--orange)] text-[var(--ink)] shadow-[4px_4px_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--ink)] active:translate-x-0 active:translate-y-0 active:shadow-none",
    secondary:
      "bg-[var(--surface)] text-[var(--ink)] shadow-[4px_4px_0_var(--ink)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--ink)] active:translate-x-0 active:translate-y-0 active:shadow-none",
    ghost:
      "border-transparent bg-transparent text-[var(--ink)] shadow-none hover:bg-[var(--peach)]",
  };

  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Input — labelled, 2px ink border, focus ring in orange-deep         */
/* ------------------------------------------------------------------ */
type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ label, error, className = "", id, ...props }: InputProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[13px] font-semibold uppercase tracking-wide text-[var(--ink)]"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && inputId ? `${inputId}-error` : undefined}
        className={`min-h-[44px] w-full rounded-[4px] border-2 border-[var(--ink)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--orange-deep)] ${
          error ? "border-[var(--terracotta)]" : ""
        } ${className}`}
        {...props}
      />
      {error && (
        <p
          id={inputId ? `${inputId}-error` : undefined}
          role="alert"
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--terracotta)]"
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Select — labelled native select, same brutal treatment as Input     */
/* ------------------------------------------------------------------ */
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  children: ReactNode;
};

export function Select({ label, error, className = "", id, children, ...props }: SelectProps) {
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="text-[13px] font-semibold uppercase tracking-wide text-[var(--ink)]"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && selectId ? `${selectId}-error` : undefined}
        className={`brutal-input appearance-none ${error ? "border-[var(--terracotta)]" : ""} ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p
          id={selectId ? `${selectId}-error` : undefined}
          role="alert"
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--terracotta)]"
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card — surface + 2px ink border + offset shadow                     */
/* ------------------------------------------------------------------ */
export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`brutal-card p-5 ${className}`}>{children}</Tag>;
}

/* ------------------------------------------------------------------ */
/* StatCard — KPI tile with optional link; tabular figures             */
/* ------------------------------------------------------------------ */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: "neutral" | "alert" | "good";
}) {
  const toneColor =
    tone === "alert"
      ? "text-[var(--terracotta)]"
      : tone === "good"
        ? "text-[var(--teal)]"
        : "text-[var(--ink)]";

  const body = (
    <>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </span>
      <span className={`tabular font-[var(--font-space-grotesk)] text-3xl font-bold ${toneColor}`}>
        {value}
      </span>
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="brutal-card brutal-lift flex min-h-[44px] flex-col gap-1.5 p-4"
        aria-label={`${label}: ${value}`}
      >
        {body}
      </a>
    );
  }
  return <div className="brutal-card flex flex-col gap-1.5 p-4">{body}</div>;
}

/* ------------------------------------------------------------------ */
/* StatusBadge — workflow status: icon + text + color, always          */
/* ------------------------------------------------------------------ */
const STATUS_META: Record<
  string,
  { icon: typeof Circle; className: string }
> = {
  Open: { icon: Circle, className: "bg-[var(--surface)] text-[var(--ink)]" },
  "In Progress": { icon: PlayCircle, className: "bg-[var(--indigo)] text-white" },
  "Awaiting Information": { icon: Info, className: "bg-[var(--peach)] text-[var(--ink)]" },
  Resolved: { icon: CheckCircle2, className: "bg-[var(--teal)] text-white" },
  Closed: { icon: Lock, className: "bg-[var(--sand)] text-[var(--muted)]" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.Open;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-semibold ${meta.className}`}
    >
      <Icon aria-hidden="true" size={13} />
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* AttentionBadge — SLA attention state: icon + text + color, always   */
/* ------------------------------------------------------------------ */
const ATTENTION_META: Record<
  string,
  { icon: typeof Clock; className: string }
> = {
  Normal: { icon: Check, className: "bg-[var(--sand)] text-[var(--ink)]" },
  "Approaching Deadline": {
    icon: Clock,
    className: "bg-[var(--apricot)] text-[var(--ink)]",
  },
  Overdue: { icon: TriangleAlert, className: "bg-[var(--terracotta)] text-white" },
  "Escalation Review Required": {
    icon: Flame,
    className: "bg-[var(--orange-deep)] text-white",
  },
  Stale: { icon: Hourglass, className: "bg-[var(--muted)] text-white" },
};

export function AttentionBadge({ state }: { state: string }) {
  const meta = ATTENTION_META[state] ?? ATTENTION_META.Normal;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-semibold ${meta.className}`}
    >
      <Icon aria-hidden="true" size={13} />
      {state}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader — title, subtitle, actions row                           */
/* ------------------------------------------------------------------ */
export function PageHeader({
  title,
  subtitle,
  actions,
  label,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  label?: string;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        {label && <SectionLabel>{label}</SectionLabel>}
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="max-w-2xl text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* LoadingSkeleton / ErrorState / EmptyState                           */
/* ------------------------------------------------------------------ */
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-12 rounded-[4px] border-2 border-[var(--line)]" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="alert"
      className="brutal-card flex items-start gap-3 border-[var(--terracotta)] bg-[var(--peach)] p-5"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--terracotta)]" size={20} />
      <div>
        <h2 className="text-base font-bold text-[var(--ink)]">{title}</h2>
        {detail && <p className="mt-1 text-sm text-[var(--ink)]">{detail}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="brutal-card flex flex-col items-center gap-2 p-8 text-center">
      <div className="w-44 opacity-90">
        <StairsToNowhere />
      </div>
      <h2 className="text-lg font-bold text-[var(--ink)]">{title}</h2>
      {detail && <p className="max-w-md text-sm text-[var(--muted)]">{detail}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SearchValue — wrapped search input with submit handler               */
/* ------------------------------------------------------------------ */
export function SearchValue({
  defaultValue = "",
  onSearch,
  placeholder = "Search…",
}: {
  defaultValue?: string;
  onSearch: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const value = (form.querySelector("input[name='q']") as HTMLInputElement | null)?.value ?? ""
        if (value.trim()) onSearch(value.trim())
      }}
      className="flex w-full max-w-md"
    >
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          size={16}
        />
        <input
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="brutal-input pl-9"
          autoComplete="off"
        />
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* DataTable — semantic table, sticky header, mobile card rows         */
/* ------------------------------------------------------------------ */
export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption?: string;
}) {
  return (
    <div className="brutal-card overflow-x-auto p-0">
      <table className="data-table responsive-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.header} scope="col" className={col.className}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.header} data-label={col.header} className={col.className}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog — focus-trapped modal, Escape to close                       */
/* ------------------------------------------------------------------ */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="brutal-card w-full max-w-lg p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-9 w-9 items-center justify-center rounded-[4px] border-2 border-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--peach)]"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast — small persistent confirmations, reduced-motion safe         */
/* ------------------------------------------------------------------ */
type ToastItem = { id: number; message: string; tone: "ok" | "error" };
const ToastContext = createContext<
  ((message: string, tone?: "ok" | "error") => void) | null
>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = (message: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`brutal-card flex items-start gap-2 p-3 text-sm ${
              t.tone === "error"
                ? "bg-[var(--peach)]"
                : "bg-[var(--surface)]"
            }`}
          >
            {t.tone === "error" ? (
              <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-[var(--terracotta)]" />
            ) : (
              <CheckCircle2 aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-[var(--teal)]" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => {});
}

/* ------------------------------------------------------------------ */
/* NotificationBell — unread count + link (header)                     */
/* ------------------------------------------------------------------ */
export function NotificationBell({ unread, href }: { unread: number; href: string }) {
  return (
    <a
      href={href}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--peach)]"
    >
      <Bell aria-hidden="true" size={18} />
      {unread > 0 && (
        <span className="tabular absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--orange)] px-1 text-[10px] font-bold">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </a>
  );
}

export type { FormEvent };