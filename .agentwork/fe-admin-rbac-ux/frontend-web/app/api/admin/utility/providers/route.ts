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
    const providers = await adminListUtilityTable('utility_providers', meta);
    return NextResponse.json({ success: true, providers, meta: { ...meta, count: providers.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const payload = await request.json() as Record<string, unknown>;
    const provider = await adminCreateUtilityRow('utility_providers', payload);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider.create',
      entityType: 'utility_provider',
      entityId: String((provider as Record<string, unknown>).id || ''),
      newValue: provider,
    });
    return NextResponse.json({ success: true, provider }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
