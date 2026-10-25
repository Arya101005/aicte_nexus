import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (formerly Middleware).
 *
 * This performs an OPTIMISTIC redirect only: it checks whether a Supabase
 * session cookie is present. Real session validation happens server-side in
 * every protected Server Component, Route Handler and Server Action via
 * `getUserFromHeaders()` — client/proxy guards are cosmetic by design.
 */

const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/verify"];

export function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no way to know the session state.
  // Continue and let server-side validation decide.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = /(^|;\s*)(sb-[a-z0-9-]+-auth-token|supabase-auth-token)=/.test(
    cookieHeader
  );

  const { pathname } = request.nextUrl;
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (hasSessionCookie && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!hasSessionCookie && !isAuthRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};