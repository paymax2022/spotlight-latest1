import { errorResponse } from '@/src/lib/api/responses';
import { APPROVAL_ID_RE, proxyEstateApproval } from '@/src/server/estate/approvals';

// ESTD-D027 checker step: a DIFFERENT estate admin approves; the action runs
// exactly once (a replay answers replayed=true). Idempotency-Key required.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!APPROVAL_ID_RE.test(id)) return errorResponse('Invalid approval ID', 400);
  return proxyEstateApproval(request, `approvals/${id}/approve`, { requireIdempotencyKey: true });
}
