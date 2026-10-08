import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { adminImportUtilityProducts } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const body = await request.json().catch(() => null) as Record<string, unknown>;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const products = await adminImportUtilityProducts(body.products as Record<string, unknown>[]);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.product.import',
      entityType: 'utility_product',
      newValue: { count: products.length },
    });
    return NextResponse.json({ success: true, products, count: products.length }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
