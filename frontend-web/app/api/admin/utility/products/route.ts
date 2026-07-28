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
    const products = await adminListUtilityTable('utility_products', meta);
    return NextResponse.json({ success: true, products, meta: { ...meta, count: products.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const product = await adminCreateUtilityRow('utility_products', await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.product.create',
      entityType: 'utility_product',
      entityId: String((product as Record<string, unknown>).id || ''),
      newValue: product,
    });
    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
