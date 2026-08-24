// Applicant: verify Paystack payment and mark installment as paid
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { sendTransactionalEmail } from '@/src/lib/email/transactional';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      planId: string;
      paymentId: string;
      reference: string;
    };

    if (!body.planId || !body.paymentId || !body.reference) {
      return errorResponse('planId, paymentId, and reference are required', 400);
    }

    const supabase = createAdminClient();

    // Verify ownership
    const { data: payment, error: fetchErr } = await supabase
      .from('academy_installment_payments')
      .select('*, academy_installment_plans(application_id, academy_applications(user_id, full_name, email))')
      .eq('id', body.paymentId)
      .eq('plan_id', body.planId)
      .maybeSingle();

    if (fetchErr || !payment) return errorResponse('Payment record not found', 404);

    const plan = (payment as any).academy_installment_plans;
    const app = plan?.academy_applications;
    if (app?.user_id !== user.id) return errorResponse('Forbidden', 403);

    // Guard: already paid
    if ((payment as any).status === 'paid') {
      return successResponse({ success: true, message: 'Already marked as paid.' });
    }

    // Verify with Paystack
    const result = await verifyPaystackPayment(body.reference);
    if (!result.success) {
      return errorResponse('Payment not confirmed by Paystack', 402);
    }

    // The reference alone only proves SOME payment succeeded — not that it was for
    // this instalment. Without this check an applicant could initialise a ₦100 charge
    // and pass its reference here to settle a ₦255,000 instalment.
    //
    // Money note: academy amounts are NAIRA (these tables predate the kobo convention)
    // while Paystack reports kobo, hence the ×100.
    const expectedKobo = Math.round(Number((payment as any).amount_ngn ?? 0) * 100);
    if (result.currency !== 'NGN' || result.amountKobo < expectedKobo) {
      console.error('[academy/installments/pay] amount mismatch', {
        paymentId: body.paymentId,
        expectedKobo,
        paidKobo: result.amountKobo,
        currency: result.currency,
      });
      return errorResponse('Payment amount does not match this installment', 402);
    }

    // Guard: reference reuse
    const { data: existing } = await supabase
      .from('academy_installment_payments')
      .select('id')
      .eq('payment_reference', body.reference)
      .maybeSingle();
    if (existing && (existing as any).id !== body.paymentId) {
      return errorResponse('This payment reference has already been used', 409);
    }

    // Mark as paid
    const { error: updateErr } = await supabase
      .from('academy_installment_payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_reference: body.reference,
        payment_provider: 'paystack',
      })
      .eq('id', body.paymentId);

    if (updateErr) return errorResponse(updateErr.message, 500);

    // Send confirmation email
    if (app?.email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
      const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 })
        .format((payment as any).amount_ngn);
      await sendTransactionalEmail({
        to: app.email,
        subject: 'Spotlight Film Academy — Installment Payment Confirmed',
        text: `Hello ${app.full_name},\n\nYour installment payment of ${amount} (Ref: ${body.reference}) has been confirmed.\n\nView your dashboard: ${siteUrl}/film-academy/dashboard\n\nSpotlight Film Academy Team`,
        html: `<div style="font-family:Arial,sans-serif;color:#111827;"><h2>Installment Payment Confirmed</h2><p>Hello <strong>${app.full_name}</strong>,</p><p>Your installment #${(payment as any).installment_number} payment of <strong>${amount}</strong> has been confirmed successfully.</p><p><strong>Reference:</strong> ${body.reference}</p><p><a href="${siteUrl}/film-academy/dashboard" style="background:#f59e0b;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">View Dashboard</a></p></div>`,
      }).catch(() => {});
    }

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to confirm payment');
  }
}
