"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase";
import { Input, Button, SectionLabel } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserSupabase();
    if (!supabase) {
      setError("Configuration error: Supabase URL or anon key missing.");
      setLoading(false);
      return;
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.replace("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Login failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--paper)] p-6">
      <div className="w-full max-w-md rounded-[6px] border-2 border-[var(--ink)] bg-[var(--surface)] p-8 shadow-[4px_4px_0_var(--ink)]">
        <div className="mb-6 flex items-center justify-between">
          <SectionLabel>Sign In</SectionLabel>
          <span className="font-[var(--font-display)] text-xl font-bold tracking-tight text-[var(--orange-deep)]">
            NEXUS
          </span>
        </div>

        <p className="mb-5 text-sm text-[var(--muted)]">
          AICTE Nexus — Integrated Institution Complaint Monitoring and Status Dashboard.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-[4px] border-2 border-[var(--terracotta)] bg-[var(--peach)] px-3 py-2.5 text-sm text-[var(--ink)]"
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.gov.in"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <Button type="submit" disabled={loading} className="mt-2 w-full">
            {loading ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm text-[var(--muted)]">
          <a href="/forgot-password" className="underline hover:text-[var(--orange-deep)]">
            Forgot password?
          </a>
          <a href="/register" className="underline hover:text-[var(--orange-deep)]">
            Create account
          </a>
        </div>
      </div>
    </main>
  );
}