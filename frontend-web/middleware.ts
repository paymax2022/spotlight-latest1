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
// This re-export is the whole fix: it puts a middleware entry point where Next
// looks, without moving the implementation or touching the documented path.
export { middleware, config } from './src/middleware';
