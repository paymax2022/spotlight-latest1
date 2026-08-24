// Applicant: track my own application — status, timeline, and what I need to do next.
//
// Scoped to the authenticated user by construction: every row is reached through the
// application that `user_id` owns, so there is no id parameter an applicant could
// tamper with to read someone else's application.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type RequiredAction = {
  key: string;
  label: string;
  detail: string;
  amountNgn?: number;
  dueDate?: string | null;
};

// Deliberately no route/href: the mobile app and the web console have different
// routing, so each client maps `key` to its own destination. Returning one
// client's path here would send the other client somewhere that does not exist.

const APPLICATION_SELECT = [
  'id',
  'status',
  'payment_status',
  'application_fee_paid',
  'tuition_total_ngn',
  'full_name',
  'email',
  'phone',
  'batch_id',
  'talent_category',
  'created_at',
  'academy_batches(batch_name, start_date, end_date)',
].join(', ');

/**
 * Applications submitted before a user_id was stamped (or submitted while signed out and
 * later claimed) are matched on email and adopted, so an applicant does not lose sight of
 * their own application.
 */
async function findMyApplication(
  supabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string },
) {
  const { data: byUser, error: byUserError } = await supabase
    .from('academy_applications')
    .select(APPLICATION_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUserError) throw byUserError;
  if (byUser) return byUser as unknown as Record<string, unknown>;

  if (!user.email) return null;

  const { data: byEmail, error: byEmailError } = await supabase
    .from('academy_applications')
    .select(APPLICATION_SELECT)
    .eq('email', user.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEmailError) throw byEmailError;
  if (!byEmail) return null;

  await supabase
    .from('academy_applications')
    .update({ user_id: user.id })
    .eq('id', (byEmail as unknown as Record<string, unknown>).id as string);

  return byEmail as unknown as Record<string, unknown>;
}

function buildActions(
  application: Record<string, any>,
  payments: Array<Record<string, any>>,
): RequiredAction[] {
  const actions: RequiredAction[] = [];
  const status = String(application.status ?? 'pending');

  // The application fee is charged at submit time and is non-refundable. If it did not
  // settle, nothing downstream can proceed.
  //
  // `application_fee_paid` is NUMERIC (the naira amount collected), not a boolean — a
  // `=== true` test here silently never matches and would tell every applicant their
  // fee was outstanding.
  const feePaid =
    Number(application.application_fee_paid ?? 0) > 0 || application.payment_status === 'paid';
  if (!feePaid) {
    actions.push({
      key: 'pay_application_fee',
      label: 'Complete your application fee',
      detail:
        'Your application was saved but the application fee has not been confirmed yet. It must be paid before your application can be reviewed.',
    });
  }

  if (status === 'pending' || status === 'under_review' || status === 'submitted') {
    actions.push({
      key: 'await_review',
      label: 'Awaiting review',
      detail: 'No action needed from you right now. We will notify you once a decision is made.',
    });
  }

  // Tuition only becomes payable once the application is approved.
  if (status === 'approved') {
    const outstanding = payments
      .filter((p) => p.status !== 'paid' && p.status !== 'waived')
      .sort((a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0));

    if (outstanding.length > 0) {
      const next = outstanding[0];
      actions.push({
        key: 'pay_tuition',
        label:
          outstanding.length === 1
            ? 'Pay your tuition'
            : `Pay tuition instalment ${next.installment_number} of ${payments.length}`,
        detail: 'Your application was approved. Pay to secure your place and start learning.',
        amountNgn: Number(next.amount_ngn ?? 0),
        dueDate: (next.due_date as string) ?? null,
      });
    } else if (payments.length > 0) {
      actions.push({
        key: 'start_learning',
        label: 'Start learning',
        detail: 'Your tuition is fully paid. Your classes are ready.',
      });
    }
  }

  if (status === 'rejected') {
    actions.push({
      key: 'application_closed',
      label: 'Application not successful',
      detail: 'This application was not accepted. You may apply again in a future batch.',
    });
  }

  return actions;
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const application = await findMyApplication(supabase, user);
    if (!application) {
      return successResponse({
        success: true,
        application: null,
        timeline: [],
        plan: null,
        payments: [],
        actions: [],
      });
    }

    const applicationId = application.id as string;

    const [historyRes, planRes] = await Promise.all([
      supabase
        .from('academy_application_status_history')
        .select('id, old_status, new_status, change_reason, created_at')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('academy_installment_plans')
        .select('*, academy_installment_payments(*)')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (historyRes.error) {
      console.error('[academy/application] status history failed', historyRes.error);
      return errorResponse('Failed to load application timeline', 500);
    }
    if (planRes.error) {
      console.error('[academy/application] plan lookup failed', planRes.error);
      return errorResponse('Failed to load tuition plan', 500);
    }

    const plan = (planRes.data as Record<string, any> | null) ?? null;
    const payments: Array<Record<string, any>> = plan?.academy_installment_payments ?? [];
    payments.sort(
      (a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0),
    );

    // The submission itself is not written to the history table, so it is synthesised here
    // rather than left as a gap at the top of the applicant's timeline.
    const timeline = [
      {
        id: `${applicationId}-submitted`,
        old_status: null,
        new_status: 'submitted',
        change_reason: 'Application submitted',
        created_at: application.created_at,
      },
      ...(historyRes.data ?? []),
    ];

    return successResponse({
      success: true,
      application,
      timeline,
      plan,
      payments,
      actions: buildActions(application as Record<string, any>, payments),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load application');
  }
}
