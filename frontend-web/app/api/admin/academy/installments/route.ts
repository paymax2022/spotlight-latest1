import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

function nextDueDate(start: Date, index: number, frequency: string): Date {
  if (frequency === 'weekly')   { const d = new Date(start); d.setDate(d.getDate() + index * 7); return d; }
  if (frequency === 'biweekly') { const d = new Date(start); d.setDate(d.getDate() + index * 14); return d; }
  const d = new Date(start); d.setMonth(d.getMonth() + index); return d;
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const { searchParams } = new URL(request.url);
    const batchId       = searchParams.get('batchId');
    const applicationId = searchParams.get('applicationId');

    const supabase = createAdminClient();
    let q = supabase
      .from('academy_installment_plans')
      .select('*, academy_installment_payments(*), academy_applications(full_name,email,batch_id)')
      .order('created_at', { ascending: false });

    if (batchId)       q = q.eq('batch_id', batchId);
    if (applicationId) q = q.eq('application_id', applicationId);

    const { data, error } = await q;
    if (error) return errorResponse('Failed to load plans', 500);
    return successResponse({ success: true, plans: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load installment plans');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = (await request.json()) as {
      applicationId: string; batchId?: string;
      totalAmountNgn: number; installmentsCount: number;
      frequency: string; startDate: string; notes?: string;
    };

    if (!body.applicationId)                             return errorResponse('applicationId required', 400);
    if (!body.totalAmountNgn || body.totalAmountNgn <= 0) return errorResponse('totalAmountNgn required', 400);
    if (!body.installmentsCount || body.installmentsCount < 1) return errorResponse('installmentsCount required', 400);

    const supabase = createAdminClient();

    const { data: plan, error: planErr } = await supabase
      .from('academy_installment_plans')
      .insert({
        application_id:    body.applicationId,
        batch_id:          body.batchId ?? null,
        total_amount_ngn:  body.totalAmountNgn,
        installments_count: body.installmentsCount,
        frequency:         body.frequency ?? 'monthly',
        notes:             body.notes ?? null,
        created_by:        identity.actorId === 'system' ? null : identity.actorId,
      })
      .select('*')
      .single();

    if (planErr || !plan) return errorResponse(planErr?.message ?? 'Failed to create plan', 500);

    const amt   = Math.round((body.totalAmountNgn / body.installmentsCount) * 100) / 100;
    const start = new Date(body.startDate || Date.now());

    const payments = Array.from({ length: body.installmentsCount }, (_, i) => ({
      plan_id:            (plan as any).id,
      installment_number: i + 1,
      amount_ngn: i === body.installmentsCount - 1
        ? Math.round((body.totalAmountNgn - amt * (body.installmentsCount - 1)) * 100) / 100
        : amt,
      due_date: nextDueDate(start, i, body.frequency ?? 'monthly').toISOString().slice(0, 10),
      status: 'pending',
    }));

    const { error: payErr } = await supabase.from('academy_installment_payments').insert(payments);
    if (payErr) return errorResponse(payErr.message, 500);

    return successResponse({ success: true, plan }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create installment plan');
  }
}
