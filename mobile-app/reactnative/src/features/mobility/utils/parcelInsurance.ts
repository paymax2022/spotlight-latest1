// Parcel insurance paid at booking (ADR-PR836): the sender ticks "insure", the
// wallet is charged fare + the estimate's premium together, and the parcel
// detail reports where that premium is. Pure helpers, no RN imports, so they
// run under node --test. Every price is the SERVER's — nothing here prices.

interface InsuranceEstimate {
  fareKobo: number;
  insuranceKobo: number;
  insurance?: unknown | null;
}

export interface ParcelInsuranceSelection {
  /** Cover is on offer for this route (the estimate carries a cover descriptor). */
  offered: boolean;
  /** Ticked AND the estimate priced a premium (a declared value was entered). */
  insured: boolean;
  /** Ticked but no premium yet: the item value is still empty. */
  needsDeclaredValue: boolean;
  premiumKobo: number;
  /** What the pay sheet charges: fare, plus the premium only when insured. */
  payableKobo: number;
}

export function parcelInsuranceSelection(est: InsuranceEstimate | undefined, ticked: boolean): ParcelInsuranceSelection {
  const offered = !!est?.insurance;
  const premium = est && offered && est.insuranceKobo > 0 ? est.insuranceKobo : 0;
  const insured = offered && ticked && premium > 0;
  return {
    offered,
    insured,
    needsDeclaredValue: offered && ticked && premium === 0,
    premiumKobo: insured ? premium : 0,
    payableKobo: (est?.fareKobo ?? 0) + (insured ? premium : 0),
  };
}

/** Booking fields for the tick: `insure` + the premium the customer saw, or nothing. */
export function bookingInsuranceFields(sel: ParcelInsuranceSelection): { insure?: true; expectedInsuranceKobo?: number } {
  return sel.insured ? { insure: true, expectedInsuranceKobo: sel.premiumKobo } : {};
}

// ── Booking refusals ────────────────────────────────────────────────────────
// Every one of these is returned BEFORE any money moves, so each message can
// say the booking was not charged.

export type ParcelBookingError =
  | { kind: 'profile_incomplete'; missing: string[]; message: string }
  | { kind: 'declared_value_required'; message: string }
  | { kind: 'card_not_supported'; message: string }
  | { kind: 'insurance_unavailable'; message: string }
  | { kind: 'insufficient_funds'; message: string }
  | { kind: 'fare_changed'; fareKobo: number | null; insuranceKobo: number | null; message: string }
  | { kind: 'key_conflict'; message: string };

const MISSING_FIELD_LABELS: Record<string, string> = {
  first_name: 'first name',
  last_name: 'last name',
  email: 'email address',
  phone: 'phone number',
  gender: 'gender',
  date_of_birth: 'date of birth',
  address: 'home address',
};

export function missingFieldLabel(field: string): string {
  return MISSING_FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

/** "gender, date of birth and home address" */
export function missingFieldsSentence(fields: readonly string[]): string {
  const labels = fields.map(missingFieldLabel);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function naira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
}

function koboField(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** Classifies a parcel booking (or card checkout) refusal; null = not one of ours. */
export function parcelBookingErrorFrom(err: unknown): ParcelBookingError | null {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | undefined;
  const status = e?.response?.status;
  const data = e?.response?.data;
  const code = typeof data?.code === 'string' ? data.code : undefined;
  switch (code) {
    case 'INSURANCE_PROFILE_INCOMPLETE': {
      const missing = Array.isArray(data?.missing) ? data.missing.filter((f): f is string => typeof f === 'string') : [];
      const what = missing.length ? `Add your ${missingFieldsSentence(missing)}` : 'Complete your profile';
      return {
        kind: 'profile_incomplete',
        missing,
        message: `The insurer needs a few profile details to cover this parcel. ${what} in your profile, or untick insurance. You were not charged.`,
      };
    }
    case 'INSURANCE_DECLARED_VALUE_REQUIRED':
      return { kind: 'declared_value_required', message: 'Enter the value of the item to insure it, or untick insurance. You were not charged.' };
    case 'INSURANCE_CARD_NOT_SUPPORTED':
      return { kind: 'card_not_supported', message: 'Insurance can only be paid from your wallet for now. Pay with your wallet, or untick insurance to pay by card.' };
    case 'INSURANCE_UNAVAILABLE':
      return { kind: 'insurance_unavailable', message: 'Parcel insurance is not available right now. Untick it to book without cover. You were not charged.' };
    case 'INSUFFICIENT_FUNDS':
      return { kind: 'insufficient_funds', message: 'Your wallet balance does not cover the delivery fee and insurance. Top up your wallet or untick insurance. You were not charged.' };
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return { kind: 'key_conflict', message: 'This booking could not be completed as it was. You were not charged — tap Book courier again.' };
    case 'FARE_CHANGED': {
      if (status !== 409) return null;
      const fareKobo = koboField(data?.fare_kobo);
      const insuranceKobo = koboField(data?.insurance_kobo);
      if (fareKobo === null && insuranceKobo === null) return null;
      const changed = [
        fareKobo !== null ? `delivery price changed to ${naira(fareKobo)}` : null,
        insuranceKobo !== null ? `insurance price changed to ${naira(insuranceKobo)}` : null,
      ].filter(Boolean).join(' and the ');
      return {
        kind: 'fare_changed',
        fareKobo,
        insuranceKobo,
        message: `The ${changed}. This booking was not charged — check the new price and tap Book again.`,
      };
    }
  }
  if (status === 402) {
    return { kind: 'insufficient_funds', message: 'Your wallet balance does not cover this booking. Top up your wallet and try again. You were not charged.' };
  }
  return null;
}

// ── Parcel detail ───────────────────────────────────────────────────────────

export type ParcelInsuranceStatus = 'none' | 'declined' | 'held' | 'binding' | 'bound' | 'refunded' | 'refund_failed';

export interface ParcelInsuranceStatusView {
  tone: 'success' | 'info' | 'warning';
  title: string;
  body: string;
}

/** What the sender sees about their cover; null when they did not buy any. */
export function parcelInsuranceStatusView(p: {
  insuranceOpted?: boolean;
  insuranceStatus?: string;
  insurancePaidKobo?: number;
  phase?: string;
}): ParcelInsuranceStatusView | null {
  if (!p.insuranceOpted) return null;
  const paid = p.insurancePaidKobo && p.insurancePaidKobo > 0 ? naira(p.insurancePaidKobo) : 'the premium';
  switch (p.insuranceStatus) {
    case 'bound':
      return { tone: 'success', title: 'Covered', body: 'Your parcel is insured against loss, fire and theft in transit.' };
    case 'held':
    case 'binding':
      return {
        tone: 'info',
        title: 'Cover being arranged',
        body: `You paid ${paid} for insurance. The insurer confirms your cover when a courier accepts the parcel.`,
      };
    case 'refunded':
      return p.phase === 'cancelled'
        ? { tone: 'info', title: 'Insurance refunded', body: `${paid} went back to your wallet because the delivery was cancelled.` }
        : { tone: 'warning', title: 'Insurance refunded', body: `We could not arrange cover, so ${paid} went back to your wallet. Your parcel is still on its way, without insurance.` };
    case 'refund_failed':
      return { tone: 'warning', title: 'Insurance refund in progress', body: `We could not arrange cover. Your ${paid} refund is being processed — no action is needed.` };
    default:
      return null;
  }
}
