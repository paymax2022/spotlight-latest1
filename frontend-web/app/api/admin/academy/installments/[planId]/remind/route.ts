// Send email reminder for overdue/upcoming installments on a plan
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { sendTransactionalEmail } from '@/src/lib/email/transactional';

export async function POST(request: Request, ctx: { params: Promise<{ planId: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();

    // Fetch plan + applicant info + pending payments
    const { data: plan, error } = await supabase
      .from('academy_installment_plans')
      .select('*, academy_applications(full_name, email), academy_installment_payments(*)')
      .eq('id', params.planId)
      .maybeSingle();

    if (error || !plan) return errorResponse('Plan not found', 404);

    const app = (plan as any).academy_applications;
    if (!app?.email) return errorResponse('Applicant email not found', 400);

    const pending = ((plan as any).academy_installment_payments ?? [])
      .filter((p: any) => ['pending', 'overdue'].includes(p.status))
      .sort((a: any, b: any) => a.installment_number - b.installment_number);

    if (pending.length === 0) {
      return successResponse({ success: true, message: 'No pending payments — no email sent.' });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
    const fmt = (n: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(n);

    const rows = pending
      .map((p: any) => `  • Installment ${p.installment_number}: ${fmt(p.amount_ngn)} — due ${p.due_date}`)
      .join('\n');

    const htmlRows = pending
      .map((p: any) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;">#${p.installment_number}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;">${fmt(p.amount_ngn)}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;">${p.due_date}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:${p.status === 'overdue' ? '#dc2626' : '#d97706'};font-weight:600;">${p.status}</td></tr>`)
      .join('');

    await sendTransactionalEmail({
      to: app.email,
      subject: 'Spotlight Film Academy — Training Fee Payment Reminder',
      text: [
        `Hello ${app.full_name},`,
        '',
        'This is a friendly reminder about your outstanding Spotlight Film Academy training fee installments:',
        '',
        rows,
        '',
        `Please log in to your academy dashboard to make payment: ${siteUrl}/film-academy/dashboard`,
        '',
        'If you have already made a payment, please disregard this message.',
        '',
        'Spotlight Film Academy Team',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6;max-width:560px;">
          <h2 style="color:#111827;">Training Fee Payment Reminder</h2>
          <p>Hello <strong>${app.full_name}</strong>,</p>
          <p>This is a friendly reminder about your outstanding Spotlight Film Academy training fee installments:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <thead><tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">#</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Amount</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Due Date</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Status</th>
            </tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
          <p><a href="${siteUrl}/film-academy/dashboard" style="display:inline-block;background:#f59e0b;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Pay Now</a></p>
          <p style="color:#6b7280;font-size:13px;">If you have already made a payment, please disregard this message.</p>
          <p>Spotlight Film Academy Team</p>
        </div>
      `,
    });

    // Update reminder timestamps + overdue status
    const today = new Date().toISOString().slice(0, 10);
    await Promise.all(
      pending.map((p: any) =>
        supabase
          .from('academy_installment_payments')
          .update({
            reminder_sent_at: new Date().toISOString(),
            reminder_count: (p.reminder_count ?? 0) + 1,
            status: p.due_date < today ? 'overdue' : p.status,
          })
          .eq('id', p.id),
      ),
    );

    return successResponse({ success: true, reminded: pending.length, email: app.email });
  } catch (error) {
    return handleApiError(error, 'Failed to send reminder');
  }
}
