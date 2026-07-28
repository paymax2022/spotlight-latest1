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
    const mappings = await adminListUtilityTable('utility_provider_product_mappings', meta);
    return NextResponse.json({ success: true, mappings, meta: { ...meta, count: mappings.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const mapping = await adminCreateUtilityRow('utility_provider_product_mappings', await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider_product_mapping.create',
      entityType: 'utility_provider_product_mapping',
      entityId: String((mapping as Record<string, unknown>).id || ''),
      newValue: mapping,
    });
    return NextResponse.json({ success: true, mapping }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
