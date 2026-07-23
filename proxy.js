import { NextResponse } from "next/server";

// Cheap gate only: middleware runs before the DB is reachable, so it just
// checks that a session cookie exists and bounces obvious anonymous traffic.
// Real authentication happens in lib/http.js on every API call — this exists to
// avoid rendering a console shell that is about to 401 on every request.
// /api/jobs/tick is cookie-less on purpose: an external cron authenticates with
// the CRON_SECRET bearer token the route itself checks, so the session gate here
// would only ever reject legitimate callers.
const PUBLIC = ["/login", "/api/auth/login", "/api/health", "/api/jobs/tick"];

export function proxy(req) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has("esl_session");
  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Sign in required" } },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
