import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/modules/facilities-rbac — Get facilities RBAC for all roles
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    // Get all roles
    const { data: rolesData, error: rolesError } = await supabase
      .from('roles')
      .select('id, name');

    if (rolesError) throw rolesError;

    // Get role permissions
    const { data: rolePermsData, error: rolePermsError } = await supabase
      .from('role_permissions')
      .select(`
        role_id,
        permission_id,
        permissions(slug, name)
      `);

    if (rolePermsError) throw rolePermsError;

    // Build RBAC data
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
