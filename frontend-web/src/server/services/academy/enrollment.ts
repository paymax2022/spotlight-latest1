// Enrolment — the anchor for everything a learner does.
//
// Lesson progress and assignment submissions are both keyed on enrollment_id, so
// until an enrolment exists a learner cannot start, and nothing created one. This
// is that missing step.
//
// The gate is deliberately "approved AND the first instalment settled" rather than
// "fully paid": a three-month plan would otherwise keep a paying learner locked out
// until the course was nearly over. Batches with no tuition enrol on approval.
import { createAdminClient } from '@/lib/supabase/server';

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
  }
  // No plan at all = nothing to pay (a free batch), so approval is enough.

  // A batch carries one published programme; the enrolment hangs off it so the
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
      current_stage: 'online',
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
