import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { adminCreateUtilityRow, adminListUtilityTable } from '@/src/server/utility/service';
import { adminPagination, auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    await requireUtilityManager(request);
    const meta = adminPagination(request);
    const billers = await adminListUtilityTable('utility_billers', meta);
    return NextResponse.json({ success: true, billers, meta: { ...meta, count: billers.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const biller = await adminCreateUtilityRow('utility_billers', await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.biller.create',
      entityType: 'utility_biller',
      entityId: String((biller as Record<string, unknown>).id || ''),
      newValue: biller,
    });
    return NextResponse.json({ success: true, biller }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
