// Applicant: confirm a tuition installment payment.
//
// Cut over to the Go-native money path (backend/internal/academy/tuition) — Paystack
// verification, amount/ownership checks, and the ledger journal now all happen in Go
// (previously this route verified Paystack itself and wrote academy_installment_payments
// directly with NOTHING posted to the ledger). This route is now a thin proxy: it forwards
// the confirm call to Go, and on success runs the same post-confirmation side effects that
// have always lived here (enrollment + email) — neither of which touches money.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { sendTransactionalEmail } from '@/src/lib/email/transactional';
import { ensureEnrollment } from '@/src/server/services/academy/enrollment';

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

    // The mobile/web clients don't send an Idempotency-Key for this call today.
    // Derive a deterministic one from (paymentId, reference) — a retry of the SAME
    // logical confirmation always maps to the same key, which is exactly what
    // idempotency should mean here; a different reference against the same
    // installment (which would be a distinct attempt) gets a distinct key.
    const idempotencyKey =
      request.headers.get('Idempotency-Key') ||
      request.headers.get('idempotency-key') ||
      `academy-tuition-confirm:${body.paymentId}:${body.reference}`;

    const upstream = await proxyToGoBackend(request, '/api/finance/academy/tuition/confirm', {
      method: 'POST',
      body: { planId: body.planId, paymentId: body.paymentId, reference: body.reference },
      headers: { 'Idempotency-Key': idempotencyKey },
    });

    if (upstream.status >= 400) {
      // A 409 idempotency-collision replay is not a user-facing failure — the first
      // attempt already succeeded (or is in flight); treat it the same as "already paid".
      if (upstream.status === 409) {
        const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
        if (data.code === 'idempotency_collision') {
          return successResponse({ success: true, message: 'Payment already being processed.' });
        }
      }
      return upstream;
    }

    // Post-confirmation side effects (unchanged from before the cutover): the first
    // settled instalment secures the place, so this is where learning opens up.
    // Idempotent — a later instalment simply finds the existing enrolment.
    const upstreamData = (await upstream.json()) as { data?: { applicationId?: string } };
    const applicationId = upstreamData.data?.applicationId;

    const supabase = createAdminClient();
    if (applicationId) {
      await ensureEnrollment(supabase, applicationId).catch((e) => {
        // The payment IS recorded (in Go); failing the response here would invite a
        // second charge for an instalment that is already paid.
        console.error('[academy/installments/pay] enrolment failed after payment', e);
      });
    }

    // Send confirmation email — best-effort, and needs the applicant's own record for
    // full_name/email (Go's response doesn't carry those).
    const { data: payment } = await supabase
      .from('academy_installment_payments')
      .select('installment_number, amount_ngn, academy_installment_plans(academy_applications(full_name, email))')
      .eq('id', body.paymentId)
      .maybeSingle();

    const app = (payment as any)?.academy_installment_plans?.academy_applications;
    if (app?.email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
      const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 })
        .format((payment as any)?.amount_ngn ?? 0);
      await sendTransactionalEmail({
        to: app.email,
        subject: 'Spotlight Film Academy — Installment Payment Confirmed',
        text: `Hello ${app.full_name},\n\nYour installment payment of ${amount} (Ref: ${body.reference}) has been confirmed.\n\nView your dashboard: ${siteUrl}/film-academy/dashboard\n\nSpotlight Film Academy Team`,
        html: `<div style="font-family:Arial,sans-serif;color:#111827;"><h2>Installment Payment Confirmed</h2><p>Hello <strong>${app.full_name}</strong>,</p><p>Your installment #${(payment as any)?.installment_number} payment of <strong>${amount}</strong> has been confirmed successfully.</p><p><strong>Reference:</strong> ${body.reference}</p><p><a href="${siteUrl}/film-academy/dashboard" style="background:#f59e0b;color:#000;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">View Dashboard</a></p></div>`,
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
