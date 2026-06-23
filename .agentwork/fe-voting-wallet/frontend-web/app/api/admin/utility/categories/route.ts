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
    const categories = await adminListUtilityTable('utility_category_settings', meta);
    return NextResponse.json({ success: true, categories, meta: { ...meta, count: categories.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const identity = await requireUtilityManager(request);
    const category = await adminCreateUtilityRow('utility_category_settings', await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.category.create',
      entityType: 'utility_category_setting',
      entityId: String((category as Record<string, unknown>).category || ''),
      newValue: category,
    });
    return NextResponse.json({ success: true, category }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
