// The applicant's own profile picture, read out of the answers they gave.
//
// WHY THIS EXISTS
// The status screen showed a name and a status chip and no face, even though the
// applicant uploaded one — because nothing in the app could read the value it
// was given. Two shapes arrive here and both have to work:
//
//   formData['media.profilePhoto']   an OBJECT {fileName, previewUrl, storageKey}
//   contestants.photo_url            that same object as a JSON STRING
//
// `previewUrl` is an auth-gated, API-relative route (`/api/registration/uploads/…`),
// so it is not something an <Image> can load directly — the caller resolves it
// with `resolveUploadUrl` first. This module only decides what counts as a
// picture and what does not.
//
// WHAT IT MUST NEVER DO
// Fall back to `identity.idUpload`. That is a KYC document (a licence, a national
// ID); putting it on a profile card is a privacy leak dressed up as a default.

/** The two field keys the registration templates use for a profile picture. */
const PROFILE_PHOTO_KEYS = ['media.profilePhoto', 'publicProfile.profilePhoto'] as const;

export interface ProfilePhoto {
  fileName?: string;
  previewUrl: string;
}

/**
 * A string worth handing to an image loader: an absolute URL, a native file
 * scheme, or a root-relative API route. Anything else ("not a url", a bare word)
 * is a broken value rather than a picture.
 */
function usablePreviewUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^(https?:\/\/|data:|blob:|file:|content:|\/)/i.test(raw)) return raw;
  return null;
}

function fileNameOf(value: Record<string, unknown>): string | undefined {
  const name = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  return name || undefined;
}

/** Turn one stored value (object, JSON text, or bare URL) into a photo. */
function photoFromValue(value: unknown): ProfilePhoto | null {
  if (typeof value === 'string') {
    const text = value.trim();
    // The roster column keeps the upload object as JSON text, so a value that
    // opens like an object is parsed rather than treated as an address.
    if (text.startsWith('{')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }
      return photoFromValue(parsed);
    }
    const url = usablePreviewUrl(text);
    return url ? { fileName: undefined, previewUrl: url } : null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const url = usablePreviewUrl(record.previewUrl ?? record.url);
    if (!url) return null;
    return { fileName: fileNameOf(record), previewUrl: url };
  }

  return null;
}

/** The photo from a draft's `formData`, or null when there is no usable one. */
export function pickProfilePhoto(
  formData?: Record<string, unknown> | null,
): ProfilePhoto | null {
  if (!formData || typeof formData !== 'object') return null;
  for (const key of PROFILE_PHOTO_KEYS) {
    const photo = photoFromValue(formData[key]);
    if (photo) return photo;
  }
  return null;
}

/**
 * The photo as the roster row stored it (`contestants.photo_url`).
 *
 * Separate from `pickProfilePhoto` because the caller has a different value in
 * hand: a column that may be an object, JSON text, a bare URL, or NULL.
 */
export function profilePhotoFromStored(value: unknown): ProfilePhoto | null {
  return photoFromValue(value);
}
