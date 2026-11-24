// What a failed Open Mic call should say to the artist.
//
// WHY THIS IS ITS OWN MODULE
// The three helpers below read a response body; nothing else. `api.ts` beside
// them imports the axios instance, which imports the Supabase session and the
// sign-in redirect — so an assertion about a single sentence could only be made
// by booting all of that. The rule they enforce is worth testing on its own,
// because the wrong order here turned a server that had explained itself into
// the words "request failed with status code 400".
//
// THE ORDER, AND WHY IT IS THE ORDER
//   1. `error` / `message` — a server that wrote a sentence means that sentence.
//   2. the first value of `errors` — the Open Mic hand-in route answers a refused
//      submission as `{ success: false, errors: { duplicateApplication: "You
//      already have an active submission…" } }` with HTTP 400
//      (`frontend-web/app/api/open-mic/submissions/route.ts`), which has no
//      top-level `error` key at all. Reading only `error`/`message` threw the
//      explanation away.
//   3. `Error.message` — the transport's own words ("Request failed with status
//      code 400"), a last resort and never what an artist should be told.
//   4. the caller's fallback.

function bodyOf(error: unknown): Record<string, unknown> | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** The per-field sentences a refusal carries, in the order the server sent them. */
export function fieldErrors(body: Record<string, unknown> | null): Record<string, string> {
  const raw = body?.errors;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** The sentence to show, or null when the response carried none. */
export function serverMessageOf(body: Record<string, unknown> | null): string | null {
  const fromBody = body?.error ?? body?.message;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  const fields = Object.values(fieldErrors(body));
  if (fields.length > 0) return fields[0];
  return null;
}

export function messageOf(error: unknown, fallback: string): string {
  const body = bodyOf(error);
  const fromServer = serverMessageOf(body);
  if (fromServer) return fromServer;
  const fromError = (error as { message?: unknown })?.message;
  if (typeof fromError === 'string' && fromError.trim()) return fromError.trim();
  return fallback;
}

export { bodyOf };
