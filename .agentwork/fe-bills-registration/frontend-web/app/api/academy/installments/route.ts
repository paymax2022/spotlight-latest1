// Applicant: fetch own installment plan
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

async function getLatestAcademyApplication(supabase: ReturnType<typeof createAdminClient>, user: { id: string; email?: string }) {
  const select = 'id, full_name, email, batch_id, status, payment_status, created_at, academy_batches(batch_name)';

  const { data: byUser, error: byUserError } = await supabase
    .from('academy_applications')
    .select(select)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUserError) throw byUserError;
  if (byUser) return byUser;

  if (!user.email) return null;

  const { data: byEmail, error: byEmailError } = await supabase
    .from('academy_applications')
    .select(select)
    .eq('email', user.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEmailError) throw byEmailError;

  if (byEmail?.id) {
    await supabase.from('academy_applications').update({ user_id: user.id }).eq('id', byEmail.id);
  }

  return byEmail;
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('academy_installment_plans')
      .select('*, academy_installment_payments(*), academy_applications!inner(full_name, email, batch_id, status, academy_batches(batch_name))')
      .eq('academy_applications.user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return errorResponse('Failed to load plan', 500);

    const application = data?.academy_applications ?? (await getLatestAcademyApplication(supabase, user));

    return successResponse({ success: true, plan: data ?? null, application });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load installment plan');
  }
}
