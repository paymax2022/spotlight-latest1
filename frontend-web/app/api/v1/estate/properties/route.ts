import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, unit_label, property_type, floor, block, occupancy_status, landlord_id, tenant_id';

function mapProperty(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, unitLabel: row.unit_label, propertyType: row.property_type,
    floor: row.floor ?? undefined, block: row.block ?? undefined, occupancyStatus: row.occupancy_status,
    landlordId: row.landlord_id ?? undefined, landlordName: row.landlord_id ? names[row.landlord_id] ?? undefined : undefined,
    tenantId: row.tenant_id ?? undefined, tenantName: row.tenant_id ? names[row.tenant_id] ?? undefined : undefined,
  };
}

// GET /api/v1/estate/properties — directory + occupancy summary.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json({ summary: { total: 0, occupied: 0, vacant: 0, reserved: 0, occupancyRate: 0 }, properties: [] });
    const { data: rows, error } = await supabase.from('estate_properties').select(COLS).eq('estate_id', ctx.estateId).order('unit_label', { ascending: true });
    if (error) throw error;
    const ids = (rows ?? []).flatMap((r: any) => [r.landlord_id, r.tenant_id]);
    const names = await resolveNames(supabase, ids);
    const properties = (rows ?? []).map((r) => mapProperty(r, names));
    const occupied = properties.filter((p) => p.occupancyStatus === 'occupied').length;
    const vacant = properties.filter((p) => p.occupancyStatus === 'vacant').length;
    const reserved = properties.filter((p) => p.occupancyStatus === 'reserved').length;
    const total = properties.length;
    return NextResponse.json({
      summary: { total, occupied, vacant, reserved, occupancyRate: total ? Math.round((occupied / total) * 100) : 0 },
      properties,
    });
  } catch (error) { return handleApiError(error, 'Failed to list properties'); }
}
