import { proxyEstateApproval } from '@/src/server/estate/approvals';

// ESTD-D027 maker-checker. GET lists the estate's approval requests
// (?status=pending|approved|rejected|executed|expired); POST files one
// (maker step, Idempotency-Key required). Go: /api/finance/estate/:id/admin/approvals.
export async function GET(request: Request) {
  return proxyEstateApproval(request, 'approvals');
}

export async function POST(request: Request) {
  return proxyEstateApproval(request, 'approvals', { requireIdempotencyKey: true });
}
