// Next.js only loads middleware from the directory that holds the routes it is
// serving. This project has BOTH `app/` (70 routes, at the project root) and
// `src/app/`; when both exist Next uses the root `app/` and ignores `src/app`.
//
// The real middleware lives in `src/middleware.ts` — where CLAUDE.md documents it
// and where every import path expects it — but Next was never looking there, so
// it silently did not run at all. Two things it is responsible for were therefore
// dead:
//
//   • CORS for /api/*  — the preflight was answered by Next's automatic OPTIONS
//     handler with no Access-Control-Allow-Origin, so every cross-origin call
//     from the Expo web build (http://localhost:8083 → :3000) failed with
//     net::ERR_FAILED.
//   • The Supabase session-cookie refresh.
//
// Re-exporting the implementation puts a middleware entry point where Next looks,
// without moving the implementation or touching the documented path.
export { middleware } from './src/middleware';

// `config` CANNOT be re-exported alongside it. Next parses the matcher at compile
// time, before any module is evaluated, so it has to read an object literal in
// this file. Under Next 15's webpack builder a re-export happened to survive;
// Next 16 builds with Turbopack, which rejects it outright:
//
//   Error: Next.js can't recognize the exported `config` field in route.
//          It mustn't be reexported.
//
// So this literal is the ONE definition of the matcher — `src/middleware.ts`
// deliberately does not export a `config` of its own, because two copies would
// drift and the dead one would look authoritative. Edit the matcher here.
export const config = {
  matcher: [
    /*
     * Page routes: everything except Next.js internals, static files, and API.
     */
    '/((?!_next/static|_next/image|favicon|assets|icons|images|api/).*)',
    /*
     * API routes: matched so the CORS layer can answer preflight + attach
     * Access-Control headers (the handler short-circuits before Supabase auth).
     */
    '/api/:path*',
  ],
};
