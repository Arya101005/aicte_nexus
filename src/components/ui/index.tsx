"use client";

import type { ReactNode, InputHTMLAttributes, ButtonHTMLAttributes } from "react";

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