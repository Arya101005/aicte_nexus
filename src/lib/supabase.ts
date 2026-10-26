import { createBrowserClient, createServerClient } from "@supabase/ssr";

// Create browser client for use in client components.
// Returns null during SSR so callers can no-op safely.
export function createBrowserSupabase() {
  if (typeof window === "undefined") {
    return null;
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Create server client for use in server components / route handlers /
// server actions, reading the session from the incoming request cookies.
export function createServerSupabase(headers: Headers) {
  const cookieHeader = headers.get("cookie");
  const cookies = cookieHeader
    ? cookieHeader
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : [];

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookies.map((entry) => {
            const index = entry.indexOf("=");
            if (index === -1) return { name: entry, value: "" };
            return {
              name: entry.slice(0, index),
              value: decodeURIComponent(entry.slice(index + 1)),
            };
          });
        },
        setAll() {
          // No-op: responses set cookies through the framework.
        },
      },
    }
  );
}

const GLOBAL_CACHE_KEY = "__supabaseServerCache_v1";

/** Server-side Supabase client bound to the in-flight request cookies.
 * Use this in route handlers and server actions that already depend on
 * a validated session (for example the search route).
 *
 * The cache is request-scoped in real SSR environments. This helper is
 * a thin wrapper so the search route can reuse one client after the
 * session is validated.
 */
export function getSupabaseServer() {
  const cache = (globalThis as any)[GLOBAL_CACHE_KEY] as any;

  if (cache && typeof cache === "object" && "signedIn" in cache) {
    return cache as unknown as ReturnType<typeof createServerSupabase>;
  }

  // Fallback for server environments without request-scoped caching.
  return createServerSupabase(new Headers());
}


// Simple user type
export type User = {
  id: string;
  email: string | null;
};

// Get the authenticated user from a request — use in server components,
// route handlers and server actions.
export async function getUserFromHeaders(
  headers: Headers
): Promise<User | null> {
  const supabase = createServerSupabase(headers);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return {
    id: user.id,
    email: user.email ?? null,
  };
}