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

export interface FilmAcademyOverview {
  batches: FilmAcademyBatch[];
  /** Batch ids this user has already applied to; drives the Applied state. */
  appliedBatchIds: string[];
  settings: FilmAcademySettings;
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
}
