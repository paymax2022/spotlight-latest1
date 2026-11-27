/**
 * Provider seam for contestant-photo rendering (spec §5, §10).
 *
 * One place decides *whether* a vendor can be used; `cloudinary.ts` stays the
 * only place Cloudinary HTTP lives. The job runner talks to this interface, so
 * P2's blend presets and a possible second vendor become parameters here rather
 * than a new call site scattered through the pipeline.
 *
 * Readiness is delegated to the client's own env contract
 * (`missingCloudinaryEnv`) instead of a second copy of the variable list: a
 * drifted duplicate would let the admin config surface claim "configured" while
 * every vendor call failed closed.
 *
 * `photoProviderConfig()` deliberately returns variable NAMES and booleans. This
 * is what an admin screen and the job ledger render, so echoing a value would
 * put a vendor secret in front of every operator with access to /admin.
 *
 * Nothing here is memoised. Env is fixed at process start in this deployment, so
 * a cache buys nothing, and the config surface has to answer for the process as
 * it stands — including in the tests that flip these variables per case.
 */
import {
  configured as cloudinaryConfigured,
  missingCloudinaryEnv,
  moderatePhoto,
  removeBackground,
  type BackgroundRemovalResult,
  type ModerationResult,
} from './cloudinary';

export type PhotoProviderName = 'cloudinary' | 'none';

/** The extract shape is the client's, aliased rather than redefined so the
 * runner and the vendor can never disagree about what `ok: false` carries. */
export type ExtractResult = BackgroundRemovalResult;

export interface PhotoProvider {
  name: PhotoProviderName;
  configured: boolean;
  missing: string[];
  extractBackground(sourceUrl: string): Promise<ExtractResult>;
  moderate(sourceUrl: string): Promise<ModerationResult>;
}

export function photoProviderConfig(): {
  configured: boolean;
  name: PhotoProviderName;
  missing: string[];
} {
  // `configured` comes from the client, and `missing` from the same list it
  // checks; deriving one from the other here would be a second policy.
  const configured = cloudinaryConfigured();
  return { configured, name: configured ? 'cloudinary' : 'none', missing: missingCloudinaryEnv() };
}

export function getPhotoProvider(): PhotoProvider {
  const { configured, name, missing } = photoProviderConfig();

  if (!configured) {
    const reason = `Cloudinary is not configured (missing ${missing.join(', ')})`;
    return {
      name: 'none',
      configured: false,
      missing,
      // Both branches return a result rather than throwing: the runner's
      // fail-closed rule needs to tell "no vendor" apart from "vendor refused",
      // which is what `notConfigured` is for.
      async extractBackground(): Promise<ExtractResult> {
        return { ok: false, notConfigured: true, reason };
      },
      async moderate(): Promise<ModerationResult> {
        return { approved: false, notConfigured: true, reason };
      },
    };
  }

  return {
    name,
    configured,
    missing,
    extractBackground: (sourceUrl: string) => removeBackground(sourceUrl),
    moderate: (sourceUrl: string) => moderatePhoto(sourceUrl),
  };
}
