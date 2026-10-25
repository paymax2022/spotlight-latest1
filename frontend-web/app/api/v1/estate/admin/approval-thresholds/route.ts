import { proxyEstateApproval } from '@/src/server/estate/approvals';

// ESTD-D027: the estate's active approval-threshold version plus its full,
// append-only history. Changes go through POST /estate/admin/approvals with
// action=threshold_change (always two-admin).
export async function GET(request: Request) {
  return proxyEstateApproval(request, 'approval-thresholds');
}
