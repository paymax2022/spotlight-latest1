// ── Film Academy — types ─────────────────────────────────────────────────────
// Mirrors the payloads of /api/academy/* in frontend-web, which reads Supabase.
// Field names are snake_case because that is what the API returns; they are not
// renamed here so a payload can be compared against the server without a
// mental mapping step.

export interface FilmAcademyBatch {
  id: string;
  batch_name: string;
  start_date: string | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  status: string | null;
  /** Naira, NOT kobo — this table predates the kobo convention. */
  training_fee_ngn: number | null;
  one_off_discount_pct: number | null;
  installments_count: number | null;
  fee_frequency: string | null;
  description: string | null;
}

export interface FilmAcademySettings {
  /** 'paid' means an application fee is charged before an application is accepted. */
  registration_type?: string;
  /** Naira. Charged at APPLICATION time, separate from tuition. */
  application_fee?: number;
  /** Naira. The programme-wide tuition, used when a batch carries no fee of its own. */
  tuition_fee?: number;
  [key: string]: unknown;
}


/** An admin-managed area of interest. `fee_ngn` is NAIRA and is added to the base fee. */
export interface FilmAcademyInterestArea {
  /** Written to academy_applications.areas_of_interest; stable once in use. */
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number;
}

export interface FilmAcademyOverview {
  batches: FilmAcademyBatch[];
  /** Batch ids this user has already applied to; drives the Applied state. */
  appliedBatchIds: string[];
  settings: FilmAcademySettings;
  /** Active areas with their fees, in admin display order. */
  interestAreas: FilmAcademyInterestArea[];
  /**
   * Slugs each batch offers, keyed by batch id. A batch ABSENT from this map —
   * or present with an empty list — offers every active area.
   */
  batchAreas: Record<string, string[]>;
}

export interface FilmAcademyApplicationInput {
  batch_id: string;
  full_name: string;
  email: string;
  phone: string;
  areas_of_interest: string[];
  motivation: string;
  experience?: string;
  payment_preference: 'one_off' | 'installment';
  /**
   * Paystack transaction reference for the APPLICATION fee, required when
   * settings.registration_type is 'paid'. The server re-verifies it with
   * Paystack (status success, NGN, amount >= application_fee) — the client is
   * never trusted for the amount, so a client-initialised transaction is fine.
   */
  application_fee_reference?: string;
}
