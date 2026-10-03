import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/modules/facilities-rbac — Get facilities RBAC for all roles
// E2E-SEC-054: was gated on requireRequestUser only — any signed-in user could
// dump every role's estate.admin.facilities.* permission mapping. RBAC config
// is roles:manage territory (same as /api/admin/users-roles).
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'roles:manage');
    const supabase = createAdminClient();

    const { data: rolesData, error: rolesError } = await supabase
      .from('roles')
      .select('id, name');

    if (rolesError) throw rolesError;

    const { data: rolePermsData, error: rolePermsError } = await supabase
      .from('role_permissions')
      .select(`
        role_id,
        permission_id,
        permissions(slug, name)
      `);

    if (rolePermsError) throw rolePermsError;

    const result = (rolesData ?? []).map((role: any) => {
      const rolePerms = (rolePermsData ?? [])
        .filter((rp: any) => rp.role_id === role.id)
        .map((rp: any) => rp.permissions.slug);

      return {
        roleId: role.id,
        roleName: role.name,
        permissions: {
          facilitiesCreate: rolePerms.includes('estate.admin.facilities.create'),
          facilitiesEdit: rolePerms.includes('estate.admin.facilities.edit'),
          facilitiesDelete: rolePerms.includes('estate.admin.facilities.delete'),
          facilitiesBookingsView: rolePerms.includes('estate.admin.facilities.bookings.view'),
          facilitiesBookingsApprove: rolePerms.includes('estate.admin.facilities.bookings.approve'),
          facilitiesBookingsCancel: rolePerms.includes('estate.admin.facilities.bookings.cancel'),
        },
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to get facilities RBAC');
  }
}
