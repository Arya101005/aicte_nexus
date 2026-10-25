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