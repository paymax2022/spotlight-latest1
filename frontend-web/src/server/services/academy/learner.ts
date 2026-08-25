// Resolves "who is this learner" once, so every learning route agrees on the
// answer and none of them takes an id from the client.
import { createAdminClient } from '@/lib/supabase/server';
import { ensureEnrollment, type EnrollmentGate } from './enrollment';

type Db = ReturnType<typeof createAdminClient>;

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
