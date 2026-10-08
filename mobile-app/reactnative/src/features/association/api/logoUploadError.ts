// Which step of a logo upload failed, kept apart from the screen and the
// network code so it can be unit-tested without React Native.
//
// The upload is three separate things that all used to surface as the same
// "That image couldn't be uploaded" message:
//   presign   — asking our backend for a short-lived upload URL
//   read-file — reading the picked photo off the phone
//   upload    — sending the bytes straight to storage (R2)
// Telling them apart is what turns "try again" into something diagnosable: a
// 403 from storage, a 400 from the backend and a phone that cannot read its own
// cache file are three different fixes.

export type LogoUploadStep = 'presign' | 'read-file' | 'upload';

export interface LogoUploadErrorInfo {
  /** HTTP status of the failing response, when there was one. */
  status?: number;
  /** Storage (S3/R2) error code from the response body, e.g. "SignatureDoesNotMatch". */
  code?: string;
  cause?: unknown;
}

export class LogoUploadError extends Error {
  readonly step: LogoUploadStep;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;

  constructor(step: LogoUploadStep, info: LogoUploadErrorInfo = {}) {
    super(`Logo upload failed at step "${step}"${info.status ? ` (${info.status}${info.code ? ` ${info.code}` : ''})` : ''}`);
    this.name = 'LogoUploadError';
    this.step = step;
    this.status = info.status;
    this.code = info.code;
    this.cause = info.cause;
  }
}

/**
 * A short, human-readable "where it went wrong" for the error message under the
 * logo, e.g. "while sending it to storage (403 SignatureDoesNotMatch)". Returns
 * an empty string for anything that is not a LogoUploadError so the caller can
 * fall back to its generic wording.
 */
export function describeLogoUploadFailure(err: unknown): string {
  if (!(err instanceof LogoUploadError)) return '';
  switch (err.step) {
    case 'presign':
      return err.status
        ? `while preparing the upload (server replied ${err.status})`
        : 'while preparing the upload (no reply from the server)';
    case 'read-file':
      return 'while reading the photo from your phone';
    case 'upload': {
      if (!err.status) return 'while sending it to storage (network error)';
      return `while sending it to storage (${err.status}${err.code ? ` ${err.code}` : ''})`;
    }
  }
}

/**
 * Pull the <Code> out of an S3/R2 XML error body. Only a plain identifier is
 * returned — the value ends up in a user-visible message, so anything with
 * spaces or markup is discarded rather than shown.
 */
export function parseStorageErrorCode(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const m = /<Code>([^<]*)<\/Code>/.exec(body);
  if (!m) return undefined;
  return /^[A-Za-z0-9]{1,64}$/.test(m[1]) ? m[1] : undefined;
}
