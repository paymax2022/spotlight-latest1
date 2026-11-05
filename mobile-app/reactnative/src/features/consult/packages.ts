// Provider-side package drafts. Pure and folder-local so the node runner can
// test it: the screen collects naira and minutes, the engine takes kobo.

import type { ConsultMode, ConsultVertical, PublishConsultPackageInput } from './types';

export const MIN_PACKAGE_MINUTES = 5;
export const MAX_PACKAGE_MINUTES = 480;

export interface PackageDraft {
  mode: ConsultMode;
  durationMinutes: number;
  /** What the provider typed. Grouped ("2,000") and symbol-prefixed input is accepted. */
  priceNaira: string;
}

export interface PackageOwner {
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
  vertical: ConsultVertical;
}

export function nairaToKobo(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira) || naira <= 0) return 0;
  return Math.round(naira * 100);
}

export function validatePackageDraft(draft: PackageDraft): string | null {
  if (!Number.isInteger(draft.durationMinutes)) {
    return 'Enter the duration as a whole number of minutes.';
  }
  if (draft.durationMinutes < MIN_PACKAGE_MINUTES || draft.durationMinutes > MAX_PACKAGE_MINUTES) {
    return `Duration must be between ${MIN_PACKAGE_MINUTES} and ${MAX_PACKAGE_MINUTES} minutes.`;
  }
  if (nairaToKobo(draft.priceNaira) <= 0) {
    return 'Enter a price greater than ₦0.';
  }
  return null;
}

export function packagePayload(draft: PackageDraft, owner: PackageOwner): PublishConsultPackageInput {
  return {
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    vertical: owner.vertical,
    mode: draft.mode,
    durationMinutes: draft.durationMinutes,
    priceKobo: nairaToKobo(draft.priceNaira),
  };
}
