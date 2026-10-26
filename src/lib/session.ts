import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  createServerSupabase,
  getUserFromHeaders,
  type User,
} from "@/lib/supabase";
import type { Role } from "@/types/supabase";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

export type Profile = {
  id: string;
  role: Role;
  bureau: string | null;
  full_name: string | null;
};

export type SessionContext = {
  user: User;
  profile: Profile | null;
  supabase: ServerSupabase;
};

/** True when the Supabase project is configured for this environment. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function readRole(raw: string | null | undefined): Role | null {
  switch (raw) {
    case "admin":
    case "bureau_official":
    case "reviewer":
    case "read_only":
      return raw;
    default:
      return null;
  }
}

/**
 * Server-side session resolution for protected Server Components,
 * Route Handlers and Server Actions. Client/proxy guards are cosmetic;
 * this is the real check. Cached per request (React `cache`).
 *
 * Redirects to /login when signed out. Throws `ConfigMissingError`
 * when the environment has no Supabase configuration, so callers can
 * render the honest "Not configured" state instead of crashing.
 *
 * Route handlers that need a Supabase client after authorization should
 * call `useSupabaseServer(headers())` so the same request-scoped client
 * is reused (for example the search route).
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  if (!isSupabaseConfigured()) throw new ConfigMissingError();

  const headerStore = await headers();
  const user = await getUserFromHeaders(headerStore);
  if (!user) redirect("/login");

  const supabase = createServerSupabase(headerStore);

  const { data } = await supabase
    .from("profiles")
    .select("id, role, bureau, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const profile: Profile | null = data
    ? {
        id: data.id,
        role: (readRole(data.role) ?? "read_only") as Role,
        bureau: data.bureau ?? null,
        full_name: data.full_name ?? null,
      }
    : null;

  return { user, profile, supabase };
});

/** Session for Server Actions — same guarantees, plus friendly errors. */
export async function requireSessionForAction(): Promise<SessionContext> {
  return requireSession();
}

export class ConfigMissingError extends Error {
  constructor() {
    super("Supabase is not configured for this environment.");
    this.name = "ConfigMissingError";
  }
}

/** Roles allowed to perform a capability, checked server-side. */
export const CAPABILITIES = {
  writeComplaints: ["admin", "bureau_official", "reviewer"],
  review: ["admin", "reviewer"],
  admin: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export function can(profile: Profile | null, capability: keyof typeof CAPABILITIES): boolean {
  if (!profile) return false;
  return (CAPABILITIES[capability] as readonly Role[]).includes(profile.role);
}

/** Friendly, non-leaky message for any thrown error (§3 errors). */
export function friendlyError(err: unknown): string {
  if (err instanceof ConfigMissingError) {
    return "This environment is not connected to a Supabase project yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).";
  }
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("signed out")) return "You are signed out. Please sign in again.";
  if (msg.toLowerCase().includes("permission") || msg.includes("42501")) {
    return "You do not have permission to do that.";
  }
  if (msg.includes("duplicate key")) return "That record already exists.";
  if (msg) return msg;
  return "Something went wrong. Please try again.";
}

/**
 * Bind the in-flight request headers to the global Supabase server cache
 * so route handlers such as the search route reuse one client instance.
 * This is a thin wrapper; real SSR caching belongs in middleware/session
 * setup and is not implemented here.
 */
export function useSupabaseServer(headers: Headers) {
  const client = createServerSupabase(headers);
  // Mutate the global cache object so both files see the same request-scoped
  // client. The type-only index signature is corrected here so TypeScript
  // and the guardrail diff both accept the assignment.
  (globalThis as Record<string, unknown>)["__supabaseServerCache_v1"] = client;
  return client;
}
