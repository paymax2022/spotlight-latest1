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
    const routing_rules = await adminListUtilityTable('utility_routing_rules', meta);
    return NextResponse.json({ success: true, routing_rules, meta: { ...meta, count: routing_rules.length } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const routing_rule = await adminCreateUtilityRow('utility_routing_rules', await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.routing_rule.create',
      entityType: 'utility_routing_rule',
      entityId: String((routing_rule as Record<string, unknown>).id || ''),
      newValue: routing_rule,
    });
    return NextResponse.json({ success: true, routing_rule }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
