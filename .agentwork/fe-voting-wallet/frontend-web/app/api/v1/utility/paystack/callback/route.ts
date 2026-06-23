import { handleApiError } from '@/src/lib/api/responses';
import { redirectToApp, verifyUtilityPaystackPayment } from '../_service';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reference = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
    const result = await verifyUtilityPaystackPayment(reference);
    return redirectToApp(result.transaction?.id);
  } catch (err) {
    return handleApiError(err);
  }
}
