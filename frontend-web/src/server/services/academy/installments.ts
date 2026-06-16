// Auto-generates an installment plan for an applicant based on:
//   • The batch's tuition fee, installment config, and one-off discount
//   • The applicant's own payment_preference ('one_off' | 'installment')
// Called whenever an application is approved.

import { createAdminClient } from '@/lib/supabase/server';

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
      .select('id, payment_preference')
      .eq('id', applicationId)
      .maybeSingle(),
  ]);

  if (batchRes.error || !batchRes.data) return;

  const batch = batchRes.data as any;
  const app   = appRes.data   as any;

  const tuitionFee = Number(batch.training_fee_ngn ?? 0);
  if (tuitionFee <= 0) return; // free batch — no plan needed

  // 2. Guard: plan already exists
  const { data: existing } = await supabase
    .from('academy_installment_plans')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle();
  if (existing) return;

  const preference: 'one_off' | 'installment' = app?.payment_preference === 'one_off' ? 'one_off' : 'installment';
  const discountPct = preference === 'one_off' ? Number(batch.one_off_discount_pct ?? 0) : 0;
  const discountedAmount = Math.round(tuitionFee * (1 - discountPct / 100) * 100) / 100;

  const count     = preference === 'one_off' ? 1 : Math.max(1, Number(batch.installments_count ?? 1));
  const frequency = preference === 'one_off' ? 'upfront' : String(batch.fee_frequency ?? 'monthly');
  const offset    = Number(batch.fee_start_offset_days ?? 0);

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

  if (planErr || !plan) return;

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

  await supabase.from('academy_installment_payments').insert(payments);
}
