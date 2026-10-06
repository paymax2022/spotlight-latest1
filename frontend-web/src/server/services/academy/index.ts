import { createAdminClient } from '@/lib/supabase/server';

/**
 * The single server-side read of the admin-managed application fee.
 *
 * Shared by POST /api/academy/apply (what must be paid before submit) and
 * POST /api/academy/application-fee/initiate (what gets quoted to Paystack) —
 * the two must never read different rows or quote different amounts, so the
 * query lives exactly once, here.
 */
export async function getActiveAcademySettings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_settings')
    .select('registration_type, application_fee, application_fee_refundable, tuition_fee')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Re-throwing the PostgREST error object would carry its raw message to
    // whichever caller surfaces thrown errors — collapse it to fixed text.
    console.error('[academy/settings] failed to load academy settings:', error);
    throw new Error('Failed to load academy settings');
  }

  return {
    registration_type: (data?.registration_type ?? 'free') as 'free' | 'paid',
    application_fee: Number(data?.application_fee ?? 0),
    application_fee_refundable: data?.application_fee_refundable === true,
    tuition_fee: Number(data?.tuition_fee ?? 0),
  };
}

// Enrolment — the anchor for everything a learner does.
// Lesson progress and assignment submissions are both keyed on enrollment_id, so
// until an enrolment exists a learner cannot start, and nothing created one. This
// is that missing step.
// The gate is deliberately "approved AND the first instalment settled" rather than
// "fully paid": a three-month plan would otherwise keep a paying learner locked out
// until the course was nearly over. Batches with no tuition enrol on approval.

type Db = ReturnType<typeof createAdminClient>;

export type EnrollmentGate =
  | { enrolled: true; enrollmentId: string; programId: string | null }
  | { enrolled: false; reason: 'not_approved' | 'tuition_unpaid' | 'no_application' };

/**
 * Creates the enrolment for an application if it has earned one, and returns it.
 * Idempotent: academy_enrollments has UNIQUE(application_id), so a concurrent or
 * repeated call collapses onto the existing row instead of double-enrolling.
 */
export async function ensureEnrollment(
  supabase: Db,
  applicationId: string,
): Promise<EnrollmentGate> {
  const { data: existing } = await supabase
    .from('academy_enrollments')
    .select('id, program_id')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; program_id: string | null };
    return { enrolled: true, enrollmentId: row.id, programId: row.program_id };
  }

  const { data: appRow } = await supabase
    .from('academy_applications')
    .select('id, user_id, batch_id, status, tuition_total_ngn')
    .eq('id', applicationId)
    .maybeSingle();

  if (!appRow) return { enrolled: false, reason: 'no_application' };
  const app = appRow as {
    id: string; user_id: string | null; batch_id: string | null;
    status: string | null; tuition_total_ngn: number | null;
  };

  if (app.status !== 'approved') return { enrolled: false, reason: 'not_approved' };

  // Has any tuition actually been collected? A plan with no paid instalment means
  // the place is not yet secured.
  const { data: plan } = await supabase
    .from('academy_installment_plans')
    .select('id, academy_installment_payments(status)')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (plan) {
    const payments = ((plan as { academy_installment_payments?: Array<{ status: string | null }> })
      .academy_installment_payments) ?? [];
    const anyPaid = payments.some((p) => p.status === 'paid' || p.status === 'waived');
    if (!anyPaid) return { enrolled: false, reason: 'tuition_unpaid' };
  } else {
    // A missing plan is NOT proof that nothing is owed — plan creation can fail,
    // and it silently did. Treating "no plan" as "free batch" enrolled an
    // applicant who owed ₦50,000, for nothing. Only a genuinely zero tuition
    // earns an enrolment without payment.
    let owed = Number(app.tuition_total_ngn ?? 0);
    if (owed <= 0 && app.batch_id) {
      const { data: batch } = await supabase
        .from('academy_batches')
        .select('training_fee_ngn')
        .eq('id', app.batch_id)
        .maybeSingle();
      owed = Number((batch as { training_fee_ngn: number | null } | null)?.training_fee_ngn ?? 0);
    }
    if (owed > 0) {
      console.error('[academy/enrollment] tuition owed but no plan exists — refusing to enrol', {
        applicationId, owed,
      });
      return { enrolled: false, reason: 'tuition_unpaid' };
    }
  }

  // learner's modules and lessons can be resolved without another lookup.
  let programId: string | null = null;
  if (app.batch_id) {
    const { data: program } = await supabase
      .from('academy_programs')
      .select('id')
      .eq('batch_id', app.batch_id)
      .eq('is_published', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    programId = (program as { id: string } | null)?.id ?? null;
  }

  const { data: created, error } = await supabase
    .from('academy_enrollments')
    .insert({
      application_id: applicationId,
      user_id: app.user_id,
      batch_id: app.batch_id,
      program_id: programId,
      // academy_candidate_stage is an ENUM: applied, approved, enrolled,
      // online_in_progress, … 'online' is not one of its labels, and because the
      // callers swallow enrolment errors so a payment never fails, an invalid
      // value here would have meant nobody ever enrolled — silently.
      current_stage: 'enrolled',
    })
    .select('id, program_id')
    .single();

  if (error) {
    // A racing caller won the UNIQUE(application_id) constraint. That is the
    // desired outcome, not a failure — read its row back.
    const { data: raced } = await supabase
      .from('academy_enrollments')
      .select('id, program_id')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (raced) {
      const row = raced as { id: string; program_id: string | null };
      return { enrolled: true, enrollmentId: row.id, programId: row.program_id };
    }
    console.error('[academy/enrollment] insert failed', error);
    return { enrolled: false, reason: 'not_approved' };
  }

  const row = created as { id: string; program_id: string | null };
  return { enrolled: true, enrollmentId: row.id, programId: row.program_id };
}

// Resolves "who is this learner" once, so every learning route agrees on the
// answer and none of them takes an id from the client.

export type Learner =
  | { ok: true; enrollmentId: string; programId: string | null; batchId: string | null }
  | { ok: false; reason: 'no_application' | 'not_approved' | 'tuition_unpaid' };

/**
 * The signed-in user's enrolment, creating it if they have earned it.
 *
 * Never takes an enrollmentId from the request: every learning write is scoped to
 * whatever this returns, so an applicant cannot address another learner's progress
 * or submissions by guessing an id.
 */
export async function resolveLearner(supabase: Db, userId: string): Promise<Learner> {
  const { data: appRow } = await supabase
    .from('academy_applications')
    .select('id, batch_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!appRow) return { ok: false, reason: 'no_application' };
  const app = appRow as { id: string; batch_id: string | null };

  const gate: EnrollmentGate = await ensureEnrollment(supabase, app.id);
  if (!gate.enrolled) {
    return { ok: false, reason: gate.reason === 'no_application' ? 'no_application' : gate.reason };
  }

  return {
    ok: true,
    enrollmentId: gate.enrollmentId,
    programId: gate.programId,
    batchId: app.batch_id,
  };
}

// chooses WHICH of them it offers.
// NO ROWS MEANS UNRESTRICTED — the batch offers every active area. That makes
// an empty selection a deliberate, safe state rather than a missing one, and it
// is why batches created before this feature keep working untouched.

type SupabaseLike = {
  from: (table: string) => any;
};

/** The slugs a batch offers. Empty array = unrestricted, NOT "offers nothing". */
export async function getBatchAreaSlugs(
  supabase: SupabaseLike,
  batchId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('academy_batch_interest_areas')
    .select('area_slug')
    .eq('batch_id', batchId);
  return (data ?? []).map((r: { area_slug: string }) => String(r.area_slug));
}

/**
 * Replace a batch's offered areas with exactly `slugs`.
 *
 * Delete-then-insert, deliberately: a merge would make REMOVING an area
 * impossible, so the stored set could only ever grow.
 *
 * Passing a non-array (i.e. the field was absent from the request) leaves the
 * selection alone — an edit that does not mention areas must not wipe them.
 *
 * Unknown slugs are dropped rather than inserted. The foreign key would reject
 * them anyway, and failing the whole save over one stale checkbox would lose the
 * admin's other edits.
 */
export async function replaceBatchAreas(
  supabase: SupabaseLike,
  batchId: string,
  slugs: unknown,
): Promise<void> {
  if (!Array.isArray(slugs)) return;

  const wanted = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))];

  const { data: known } = await supabase
    .from('academy_interest_areas')
    .select('slug')
    .in('slug', wanted.length ? wanted : ['__none__']);
  const valid = new Set((known ?? []).map((r: { slug: string }) => String(r.slug)));

  const { error: delError } = await supabase
    .from('academy_batch_interest_areas')
    .delete()
    .eq('batch_id', batchId);
  if (delError) {
    logAreaError('clearing the previous selection', delError);
    throw new Error('Could not update the areas this batch offers');
  }

  const rows = wanted.filter((s) => valid.has(s)).map((slug) => ({ batch_id: batchId, area_slug: slug }));
  if (rows.length > 0) {
    const { error: insError } = await supabase
      .from('academy_batch_interest_areas')
      .insert(rows);
    // The delete has already run. Swallowing this would leave the batch with NO
    // rows — which MEANS UNRESTRICTED — so a failed save would silently widen
    // what the batch offers instead of failing. Surface it.
    if (insError) {
      logAreaError('saving the new selection', insError);
      throw new Error('Could not save the areas this batch offers');
    }
  }
}

/** Detail to the server log; the thrown message is what the caller shows. */
function logAreaError(where: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: string } | null;
  console.error(`[batchAreas] ${where} failed`, {
    code: e?.code, message: e?.message, details: e?.details,
  });
}

// Instalment compliance — is this learner up to date, or in arrears?
// Derived on read, never stored. A stored "overdue" flag becomes wrong the
// moment a due date passes with nobody looking at it, and the repair job for
// that is worse than the computation.
// Money note: academy amounts are NAIRA (these tables predate the kobo
// convention used across finance). Nothing here is multiplied by 100.

export type ComplianceState = 'paid_up' | 'on_track' | 'due_soon' | 'overdue' | 'no_schedule';

export interface InstalmentLike {
  installment_number?: number | null;
  amount_ngn?: number | string | null;
  due_date?: string | null;
  paid_at?: string | null;
  status?: string | null;
}

export interface ComplianceSummary {
  state: ComplianceState;
  /** Instalments past their due date and still unsettled. */
  overdueCount: number;
  /** Naira still owed across every unsettled instalment. */
  outstandingNgn: number;
  /** Naira owed on the OVERDUE ones only — the arrears figure. */
  arrearsNgn: number;
  /** Days past due on the oldest unpaid instalment; 0 when nothing is late. */
  daysLate: number;
  /** The next instalment falling due, if any. */
  nextDueDate: string | null;
  nextDueNgn: number;
  paidCount: number;
  totalCount: number;
}

/** 'waived' settles an instalment without payment — an admin decision, not a debt. */
const SETTLED = new Set(['paid', 'waived']);

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates, floored, never negative. */
function daysBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / DAY));
}

/**
 * `now` is injected rather than read from the clock so this is testable and so a
 * caller can ask "what did compliance look like on the invoice date".
 */
export function summariseCompliance(
  payments: InstalmentLike[],
  now: Date = new Date(),
): ComplianceSummary {
  const total = payments.length;
  if (total === 0) {
    return {
      state: 'no_schedule', overdueCount: 0, outstandingNgn: 0, arrearsNgn: 0,
      daysLate: 0, nextDueDate: null, nextDueNgn: 0, paidCount: 0, totalCount: 0,
    };
  }

  const settled = payments.filter((p) => SETTLED.has(String(p.status ?? '')));
  const unsettled = payments
    .filter((p) => !SETTLED.has(String(p.status ?? '')))
    .sort((a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0));

  if (unsettled.length === 0) {
    return {
      state: 'paid_up', overdueCount: 0, outstandingNgn: 0, arrearsNgn: 0,
      daysLate: 0, nextDueDate: null, nextDueNgn: 0,
      paidCount: settled.length, totalCount: total,
    };
  }

  const nowMs = now.getTime();
  const amount = (p: InstalmentLike) => Number(p.amount_ngn ?? 0);

  // An instalment with no due date cannot be late — treat it as scheduled, not
  // overdue, rather than inventing a deadline nobody agreed to.
  const dueMs = (p: InstalmentLike) => {
    if (!p.due_date) return null;
    const t = new Date(p.due_date).getTime();
    return Number.isNaN(t) ? null : t;
  };

  const overdue = unsettled.filter((p) => {
    const d = dueMs(p);
    return d !== null && d < nowMs;
  });

  const outstandingNgn = unsettled.reduce((n, p) => n + amount(p), 0);
  const arrearsNgn = overdue.reduce((n, p) => n + amount(p), 0);

  const oldestOverdueMs = overdue
    .map(dueMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];

  const next = unsettled[0];
  const nextMs = dueMs(next);

  let state: ComplianceState;
  if (overdue.length > 0) {
    state = 'overdue';
  } else if (nextMs !== null && nextMs - nowMs <= 7 * DAY) {
    // A week's notice: enough to act on, short enough to still mean something.
    state = 'due_soon';
  } else {
    state = 'on_track';
  }

  return {
    state,
    overdueCount: overdue.length,
    outstandingNgn: Math.round(outstandingNgn * 100) / 100,
    arrearsNgn: Math.round(arrearsNgn * 100) / 100,
    daysLate: oldestOverdueMs === undefined ? 0 : daysBetween(nowMs, oldestOverdueMs),
    nextDueDate: next.due_date ?? null,
    nextDueNgn: amount(next),
    paidCount: settled.length,
    totalCount: total,
  };
}

// Auto-generates an installment plan for an applicant based on:
//   • The batch's tuition fee, installment config, and one-off discount
//   • The applicant's own payment_preference ('one_off' | 'installment')
// Called whenever an application is approved.


function nextDueDate(start: Date, index: number, frequency: string): Date {
  const d = new Date(start);
  if (frequency === 'upfront')  return d;
  if (frequency === 'weekly')   { d.setDate(d.getDate() + index * 7);  return d; }
  if (frequency === 'biweekly') { d.setDate(d.getDate() + index * 14); return d; }
  d.setMonth(d.getMonth() + index); // monthly
  return d;
}

export async function autoCreateInstallmentPlan(
  applicationId: string,
  batchId: string,
  approvedAt?: string,
): Promise<void> {
  const supabase = createAdminClient();

  // 1. Load batch fee config + applicant payment preference
  const [batchRes, appRes] = await Promise.all([
    supabase
      .from('academy_batches')
      .select('id, batch_name, training_fee_ngn, installments_count, fee_frequency, fee_start_offset_days, one_off_discount_pct')
      .eq('id', batchId)
      .maybeSingle(),
    supabase
      .from('academy_applications')
      .select('id, payment_preference, tuition_total_ngn')
      .eq('id', applicationId)
      .maybeSingle(),
  ]);

  if (batchRes.error || !batchRes.data) {
    // Silent returns here are how an approved applicant ends up with no tuition
    // plan and nobody notices. Every abort now says why.
    console.error('[academy/installments] batch lookup failed', {
      applicationId, batchId, error: batchRes.error?.message ?? 'batch not found',
    });
    return;
  }

  const batch = batchRes.data as any;
  const app   = appRes.data   as any;

  // The applicant's tuition is the sum of the priced interest areas they chose at
  // application time (`tuition_total_ngn`). The batch's flat `training_fee_ngn` is the
  // fallback for batches that predate per-area pricing, or that price the whole
  // programme as one number. Billing the batch fee to someone who selected areas would
  // charge them a figure they were never shown.
  const areaTuition  = Number(app?.tuition_total_ngn ?? 0);
  const batchTuition = Number(batch.training_fee_ngn ?? 0);
  const tuitionFee   = areaTuition > 0 ? areaTuition : batchTuition;
  if (tuitionFee <= 0) {
    console.info('[academy/installments] no tuition owed — no plan created', { applicationId });
    return; // genuinely free batch
  }

  // 2. Guard: plan already exists
  const { data: existing } = await supabase
    .from('academy_installment_plans')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle();
  if (existing) {
    console.info('[academy/installments] plan already exists', { applicationId });
    return;
  }

  const preference: 'one_off' | 'installment' = app?.payment_preference === 'one_off' ? 'one_off' : 'installment';
  const discountPct = preference === 'one_off' ? Number(batch.one_off_discount_pct ?? 0) : 0;
  const discountedAmount = Math.round(tuitionFee * (1 - discountPct / 100) * 100) / 100;

  // academy_installment_plans.frequency is CONSTRAINED to weekly|biweekly|monthly.
  // "Upfront" is not a cadence — it is a single payment, expressed as
  // academy_installment_plans_frequency_check, so a one-off plan could never be
  // created at all, nor any plan for a batch whose fee_frequency is 'upfront'.
  const PLAN_CADENCES = new Set(['weekly', 'biweekly', 'monthly']);
  const batchCadence  = String(batch.fee_frequency ?? 'monthly');
  const payUpfront    = preference === 'one_off' || !PLAN_CADENCES.has(batchCadence);

  const frequency = payUpfront ? 'monthly' : batchCadence;
  // A single instalment on any cadence falls due on the start date, so the stored
  // cadence is immaterial for an upfront plan — only the count is.
  // fail the insert the same silent way the cadence did.
  const count = payUpfront
    ? 1
    : Math.min(12, Math.max(1, Number(batch.installments_count ?? 1)));
  const offset = Number(batch.fee_start_offset_days ?? 0);

  // 3. Create the plan
  const { data: plan, error: planErr } = await supabase
    .from('academy_installment_plans')
    .insert({
      application_id:       applicationId,
      batch_id:             batchId,
      total_amount_ngn:     tuitionFee,
      installments_count:   count,
      frequency,
      plan_type:            preference,
      discount_applied_pct: discountPct,
      discounted_amount_ngn: discountedAmount,
      notes: `Auto-generated — ${preference === 'one_off' ? `one-off payment${discountPct > 0 ? ` (${discountPct}% discount applied)` : ''}` : `${count} ${frequency} installments`}`,
    })
    .select('id')
    .single();

  if (planErr || !plan) {
    console.error('[academy/installments] plan insert failed', {
      applicationId, batchId, tuitionFee, error: planErr?.message, code: (planErr as { code?: string } | null)?.code,
    });
    return;
  }

  // 4. Generate installment rows
  const base = new Date(approvedAt ?? Date.now());
  base.setDate(base.getDate() + offset);

  const unitAmt = Math.round((discountedAmount / count) * 100) / 100;

  const payments = Array.from({ length: count }, (_, i) => ({
    plan_id:            (plan as any).id,
    installment_number: i + 1,
    amount_ngn: i === count - 1
      ? Math.round((discountedAmount - unitAmt * (count - 1)) * 100) / 100
      : unitAmt,
    due_date: nextDueDate(base, i, frequency).toISOString().slice(0, 10),
    status: 'pending',
  }));

  const { error: paymentsErr } = await supabase
    .from('academy_installment_payments')
    .insert(payments);

  if (paymentsErr) {
    // A plan with no instalments is worse than no plan: the applicant sees a
    // tuition total with nothing payable against it.
    console.error('[academy/installments] instalment rows failed — plan has no payments', {
      applicationId, planId: (plan as { id: string }).id, error: paymentsErr.message,
    });
  }
}
