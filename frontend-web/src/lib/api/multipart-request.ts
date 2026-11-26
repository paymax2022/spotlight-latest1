/**
 * Distinguishing "you did not send me a file" from "your file never arrived".
 *
 * `app/api/registration/uploads/route.ts` used to answer every failure of
 * `request.formData()` with `415 Expected multipart/form-data`. Three different
 * faults share that one catch, and only the first two are actually about the
 * Content-Type:
 *
 *   1. the request is not multipart at all (JSON, or no header);
 *   2. it claims `multipart/form-data` but carries no `boundary=` to parse with;
 *   3. it is a well-formed multipart request whose body was CUT OFF in
 *      transit — Next truncates the request-body clone at
 *      `experimental.proxyClientMaxBodySize` (10 MiB unless configured: see
 *      `upload-limits.config.mjs`) and ends the stream instead of rejecting it,
 *      so undici's parser hits an unterminated part and throws
 *      `TypeError: Failed to parse body as FormData.`
 *
 * Reading the header first keeps 1 and 2 at 415 and gives 3 the status it
 * deserves (413) with a sentence the wizard can show verbatim — which is the
 * whole reason the applicant in the registration flow ever learns that their
 * file was the problem.
 */

/** Kept as the route always answered, for the two genuine content-type faults. */
export const MULTIPART_REQUIRED_MESSAGE = 'Expected multipart/form-data';

/**
 * True only for a multipart Content-Type that actually carries a non-empty
 * boundary parameter — without one there is nothing to parse, and that is the
 * caller's mistake, not a size problem.
 */
export function isMultipartWithBoundary(contentType: string | null): boolean {
  if (!contentType) return false;
  if (!/^multipart\/form-data/i.test(contentType)) return false;
  const match = contentType.match(/(?:^|;)\s*boundary\s*=\s*([^;]+)/i);
  return !!match && match[1].trim().length > 0;
}

export type FormDataParseVerdict = {
  status: number;
  message: string;
};

/**
 * Decide what to answer once `await request.formData()` has thrown.
 *
 * `maxBytes` is the route's own declared upload cap, used only to tell the
 * client how big a file the flow accepts.
 */
export function classifyFormDataParseFailure(
  contentType: string | null,
  error: unknown,
  maxBytes: number,
): FormDataParseVerdict {
  if (!isMultipartWithBoundary(contentType)) {
    return { status: 415, message: MULTIPART_REQUIRED_MESSAGE };
  }

  const message = error instanceof Error ? error.message : String(error);
  const isTruncatedBody =
    error instanceof TypeError && /failed to parse body as formdata/i.test(message);

  if (isTruncatedBody) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      status: 413,
      message:
        `Your upload was cut off before it finished. Files must stay under ${maxMb}MB, ` +
        'and a connection that drops mid-upload looks the same to the server — please try again.',
    };
  }

  // Anything else is a parser fault we do not understand; let it surface as a
  // server error instead of blaming the user's file.
  return { status: 500, message: 'Upload failed' };
}
