// ── Association — Organisation wizard field validation ────────────────────────
// One home for the rules the wizard enforces, so the step that collects a field
// and the step that publishes it cannot disagree. The server enforces the same
// rules in validateOrgIdentity (backend/internal/association/service_ext.go);
// these exist to fail on the screen rather than after a round trip.

/** Earliest founding year accepted, matching the admin console's org editor. */
export const MIN_FOUNDED_YEAR = 1800;

/** Latest accepted founding year — an organisation cannot be founded ahead of now. */
export function maxFoundedYear(): number {
  return new Date().getFullYear();
}

/**
 * Validate the founded-year text. Returns an error string, or undefined when
 * the value is acceptable.
 *
 * Deliberately strict about the shape before the range: `Number('')` is 0 and
 * `Number('19 99')` is NaN, so a bare numeric coercion would either accept
 * blank as year zero or report a confusing range error for a typo.
 */
export function foundedYearError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return 'Enter the year this organisation was founded';
  if (!/^\d{4}$/.test(value)) return 'Enter a 4-digit year, e.g. 2015';
  const year = Number(value);
  const max = maxFoundedYear();
  if (year < MIN_FOUNDED_YEAR || year > max) return `Enter a year between ${MIN_FOUNDED_YEAR} and ${max}`;
  return undefined;
}

/**
 * Validate an optional website. Blank is fine; anything present must look like
 * a URL the server can store and a browser can open, so a bare "nma.org.ng"
 * is corrected rather than silently saved as an unopenable string.
 */
export function websiteError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^https?:\/\/\S+\.\S+/i.test(value)) return 'Enter a full URL starting with https://';
  return undefined;
}

/**
 * Validate the logo. Required, and satisfied by EITHER a pasted URL or an
 * uploaded image — the wizard writes both into the same draft field.
 *
 * A picked image is uploaded to R2 first and stored as its object key, so a
 * device-local file:// URI must never survive to submission: it would be stored
 * verbatim and resolve on the founder's phone and nowhere else. Treat one as
 * "no logo yet" rather than accepting it.
 */
export function logoError(logoUri: string | null): string | undefined {
  const value = (logoUri ?? '').trim();
  if (!value) return 'Add a logo — paste a URL or upload an image';
  if (value.startsWith('file://')) return 'That image has not finished uploading yet';
  return undefined;
}

/** True when a pasted string is usable as a remote logo URL. */
export function isRemoteLogoUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

/**
 * True when the stored logo is an uploaded object key rather than a pasted URL.
 * Mirrors IsStoredObjectKey in backend/internal/association/presign.go — the
 * key prefix is minted there, and the two must agree on what a key looks like.
 */
export function isUploadedLogoKey(value: string | null): boolean {
  const v = (value ?? '').trim();
  return Boolean(v) && !v.includes('://') && v.startsWith('association/');
}
