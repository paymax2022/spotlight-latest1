// What to print under a wizard file field when an upload fails.
//
// `regUpload` already forwards the BFF's curated `error` string as the thrown
// Error's message on web, so the field renderer has everything it needs to tell
// the applicant what actually went wrong — a file over the size limit, a refused
// format, a body that never finished arriving. It used to discard that message
// and print one fixed sentence, which turned a size problem into a mystery
// (reported 2026-11-24 as "Upload failed. Please try again." over a 415).
//
// Showing every message would be just as unhelpful, because some of the shapes
// that reach here are transport plumbing rather than something a user can act
// on: `regUpload`'s own `Upload failed (500)` fallback when the response carried
// no `error` field, and the strings axios and fetch produce for a dead
// connection. Those map back to the generic line.

const GENERIC_MESSAGE = 'Upload failed. Please try again.';

/** Long enough for any curated route sentence, short enough to not be a stack. */
const MAX_MESSAGE_LENGTH = 240;

/** Messages that describe the transport, not the applicant's problem. */
const UNHELPFUL = /^(\s*(upload failed \(\d+\)|network error|request failed with status code \d+|timeout of \d+ms exceeded|fetch failed)\s*$)/i;

/**
 * Keep a message only if a person can read it as a reason. Applied to every
 * source below, so a 400-page HTML body or a megabyte-long stack never reaches
 * a field label.
 */
function curate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const message = value.trim();
  if (!message) return '';
  if (message.length > MAX_MESSAGE_LENGTH) return '';
  if (UNHELPFUL.test(message)) return '';
  return message;
}

/**
 * The sentence the BFF route put in the response body. `errorResponse` always
 * writes `{ success: false, error }`, and axios leaves the body on
 * `error.response.data` — which is how the iOS/Android upload branch fails,
 * since it posts through the shared instance instead of raw fetch.
 */
function serverMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
  return curate(data?.error);
}

function thrownMessage(error: unknown): string {
  return error instanceof Error ? curate(error.message) : '';
}

export function uploadFailureMessage(error: unknown): string {
  return serverMessage(error) || thrownMessage(error) || GENERIC_MESSAGE;
}
