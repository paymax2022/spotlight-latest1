import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Owner edits their own campaign. Subset semantics: only the keys present in the
// body change, so the body is forwarded verbatim rather than reassembled here.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/creator/campaigns/${id}`);
  } catch (err) { return handleApiError(err); }
}

// Owner deletes their own campaign. The Go handler is the authority on whether
// that is allowed — it answers 409 once the campaign has received funds — and
// that status and message pass straight back to the caller.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/creator/campaigns/${id}`);
  } catch (err) { return handleApiError(err); }
}
