import { handleApiError } from '@/src/lib/api/responses';
import { redirectToApp, verifyUtilityPaystackPayment } from '../_service';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
  const returnOrigin = url.searchParams.get('return');
  try {
    const result = await verifyUtilityPaystackPayment(reference);
    return redirectToApp(result.transaction?.id, returnOrigin, reference);
  } catch (err) {
    // verifyUtilityPaystackPayment already persisted status='failed' on the
    // intent for a real (not-yet-found) failure, so the resolver screen's own
    // poll picks that up correctly. Without this, ANY failed or unrecognised
    // payment answered with a raw JSON error and no redirect at all — a web
    // user was left stranded on the Paystack tab with nothing to click back
    // into the app, worse than the paymaxrn:// gap this route otherwise fixes.
    if (reference) return redirectToApp(undefined, returnOrigin, reference);
    return handleApiError(err);
  }
}
