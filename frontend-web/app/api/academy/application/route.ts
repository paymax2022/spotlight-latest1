// Applicant: track my own application — status, timeline, and what I need to do next.
// Scoped to the authenticated user by construction: every row is reached through the
// application that `user_id` owns, so there is no id parameter an applicant could
// tamper with to read someone else's application.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { summariseCompliance } from '@/src/server/services/academy';

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

const APPLICATION_COLUMNS = [
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
  'areas_of_interest',
  // Legacy per-area option keys (academy_area_pricing_options). No migration in
  // this repo creates it, so it is OPTIONAL — see APPLICATION_OPTIONAL_COLUMNS.
  'pricing_selections',
  // Server-priced snapshot of the chosen area options (option + boarding +
  // price). NULL on applications made before area options existed.
  'selected_options',
  'created_at',
  // academy_batches has no end_date column — asking for one makes PostgREST reject
  // the whole select, which surfaced as a bare 500 on the applicant's status screen.
  'academy_batches(batch_name, start_date)',
];
const APPLICATION_SELECT = APPLICATION_COLUMNS.join(', ');
// Columns a given database may not have: `selected_options` arrives with
// migration 20271095000000 (deploy order: this code can ship first), and
// `pricing_selections` is created by no migration at all. If either is
// missing, PostgREST rejects the whole select (42703) and the status screen
// would 500 for every applicant — so retry ONCE without both.
const APPLICATION_OPTIONAL_COLUMNS = ['selected_options', 'pricing_selections'];
const APPLICATION_SELECT_LEGACY = APPLICATION_COLUMNS.filter(
  (c) => !APPLICATION_OPTIONAL_COLUMNS.includes(c),
).join(', ');

/**
 * True only for a missing-column error that names one of the optional columns.
 * Both halves are required: a 42703 for any OTHER column is a real bug, and an
 * unrelated error that merely mentions a column name must not be swallowed.
 */
function isMissingOptionalColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message ?? '');
  const missingColumn =
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist|could not find the .* column/i.test(message);
  return missingColumn && APPLICATION_OPTIONAL_COLUMNS.some((c) => message.includes(c));
}

/** Missing table: Postgres 42P01 (undefined_table) or PostgREST PGRST205. */
function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/** The applicant's latest application matched on one column, tolerating a pre-migration DB. */
async function lookupApplication(
  supabase: ReturnType<typeof createAdminClient>,
  column: 'user_id' | 'email',
  value: string,
) {
  const run = (select: string) =>
    supabase
      .from('academy_applications')
      .select(select)
      .eq(column, value)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

  const first = await run(APPLICATION_SELECT);
  if (!isMissingOptionalColumn(first.error)) return first;
  console.warn(
    '[academy/application] optional column missing; retrying without selected_options/pricing_selections',
    first.error?.message,
  );
  return run(APPLICATION_SELECT_LEGACY);
}

// AppliedArea is one interest area the candidate chose, resolved to its display
// label and the price of the option they picked, so the status screen can show
// exactly what they applied — and are paying — for.
type AppliedArea = {
  slug: string;
  label: string;
  optionKey: string | null;
  optionLabel: string | null;
  priceNgn: number;
};

// resolveAppliedAreas turns the application's stored slugs + pricing_selections
// into labelled, priced rows. The price per area is the option the applicant
// chose (pricing_selections[slug] → academy_area_pricing_options), falling back
// to the area's own fee when no option was recorded (older applications). Returns
// [] when the areas lookup fails rather than failing the whole status screen —
// the areas are supplementary context. The legacy academy_area_pricing_options
// table may not exist (no migration creates it): a missing table is treated as
// "no options"; any other error on it throws, because silently falling back to
// fee_ngn would show the applicant a price that may be wrong.
async function resolveAppliedAreas(
  supabase: ReturnType<typeof createAdminClient>,
  application: Record<string, any>,
): Promise<AppliedArea[]> {
  const slugs = (Array.isArray(application.areas_of_interest) ? application.areas_of_interest : [])
    .map((s: unknown) => String(s))
    .filter(Boolean);
  if (slugs.length === 0) return [];

  const selections = (application.pricing_selections && typeof application.pricing_selections === 'object'
    ? application.pricing_selections
    : {}) as Record<string, string>;

  const { data: areaRows, error: areaErr } = await supabase
    .from('academy_interest_areas')
    .select('id, slug, label, fee_ngn')
    .in('slug', slugs);
  if (areaErr || !areaRows) {
    console.error('[academy/application] areas lookup failed', areaErr);
    return [];
  }
  const areas = areaRows as Array<{ id: string; slug: string; label: string; fee_ngn: number | null }>;

  const { data: optionRows, error: optionErr } = await supabase
    .from('academy_area_pricing_options')
    .select('area_id, key, label, price_ngn')
    .in('area_id', areas.map((a) => a.id));
  if (optionErr && !isMissingTableError(optionErr)) {
    console.error('[academy/application] pricing options lookup failed', optionErr);
    throw optionErr;
  }
  const options = (optionRows ?? []) as Array<{ area_id: string; key: string; label: string; price_ngn: number }>;

  // Preserve the order the applicant's slugs were stored in.
  const bySlug = new Map(areas.map((a) => [a.slug, a]));
  return slugs
    .map((slug: string): AppliedArea | null => {
      const area = bySlug.get(slug);
      if (!area) return null;
      const key = selections[slug] ?? null;
      const option = key ? options.find((o) => o.area_id === area.id && o.key === key) ?? null : null;
      return {
        slug: area.slug,
        label: area.label,
        optionKey: key,
        optionLabel: option?.label ?? null,
        priceNgn: Number(option?.price_ngn ?? area.fee_ngn ?? 0),
      };
    })
    .filter((a): a is AppliedArea => a !== null);
}

/**
 * Applications submitted before a user_id was stamped (or submitted while signed out and
 * later claimed) are matched on email and adopted, so an applicant does not lose sight of
 * their own application.
 */
async function findMyApplication(
  supabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string },
) {
  const { data: byUser, error: byUserError } = await lookupApplication(supabase, 'user_id', user.id);

  if (byUserError) {
    console.error('[academy/application] lookup by user failed', byUserError);
    throw byUserError;
  }
  if (byUser) return byUser as unknown as Record<string, unknown>;

  if (!user.email) return null;

  const { data: byEmail, error: byEmailError } = await lookupApplication(supabase, 'email', user.email);

  if (byEmailError) {
    console.error('[academy/application] lookup by email failed', byEmailError);
    throw byEmailError;
  }
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
  enrolled: boolean,
): RequiredAction[] {
  const actions: RequiredAction[] = [];
  const status = String(application.status ?? 'pending');

  // The application fee is charged at submit time and is non-refundable. If it did not
  // settle, nothing downstream can proceed.
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
        detail: enrolled
          ? 'Keep your instalments up to date to stay enrolled.'
          : 'Your application was approved. Pay to secure your place and start learning.',
        amountNgn: Number(next.amount_ngn ?? 0),
        dueDate: (next.due_date as string) ?? null,
      });
    }

    // Arrears are stated plainly rather than used to silently lock someone out.
    // Suspending access is an admin decision with real consequences for a paying
    // learner; the system's job here is to make the debt impossible to miss.
    const compliance = summariseCompliance(payments);
    if (compliance.state === 'overdue') {
      actions.unshift({
        key: 'tuition_overdue',
        label:
          compliance.overdueCount === 1
            ? 'A tuition instalment is overdue'
            : `${compliance.overdueCount} tuition instalments are overdue`,
        detail: `₦${compliance.arrearsNgn.toLocaleString('en-NG')} is past due${
          compliance.daysLate > 0 ? ` by ${compliance.daysLate} day${compliance.daysLate === 1 ? '' : 's'}` : ''
        }. Settle it to keep your place on the programme.`,
        amountNgn: compliance.arrearsNgn,
      });
    }

    // Learning opens on ENROLMENT, not on the plan being fully settled. A learner on
    // a three-month plan would otherwise be locked out until the course was nearly
    // over, despite having paid to secure the place.
    if (enrolled) {
      actions.push({
        key: 'start_learning',
        label: outstanding.length > 0 ? 'Continue learning' : 'Start learning',
        detail: 'Your place is secured. Your lessons and assignments are ready.',
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

    const [historyRes, planRes, enrolRes] = await Promise.all([
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
      supabase
        .from('academy_enrollments')
        .select('id')
        .eq('application_id', applicationId)
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

    const areas = await resolveAppliedAreas(supabase, application as Record<string, any>);

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
      enrolled: Boolean(enrolRes.data),
      compliance: summariseCompliance(payments),
      actions: buildActions(application as Record<string, any>, payments, Boolean(enrolRes.data)),
      // The interest areas the applicant chose, with the option/price they picked,
      // plus the tuition total — so the status screen can show what they applied
      // and are paying for.
      areas,
      tuitionTotalNgn: Number((application as Record<string, any>).tuition_total_ngn ?? 0),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load application');
  }
}
