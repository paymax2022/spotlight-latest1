import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const FACILITIES_PERMISSIONS = [
  'estate.admin.facilities.create',
  'estate.admin.facilities.edit',
  'estate.admin.facilities.delete',
  'estate.admin.facilities.bookings.view',
  'estate.admin.facilities.bookings.approve',
  'estate.admin.facilities.bookings.cancel',
];

// PATCH /api/admin/modules/facilities-rbac/[roleId] — Update facilities permissions for a role
export async function PATCH(request: Request, { params }: { params: { roleId: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const body = await request.json();

    const {
      facilitiesCreate,
      facilitiesEdit,
      facilitiesDelete,
      facilitiesBookingsView,
      facilitiesBookingsApprove,
      facilitiesBookingsCancel,
    } = body;

    const permissionMap = {
      facilitiesCreate: 'estate.admin.facilities.create',
      facilitiesEdit: 'estate.admin.facilities.edit',
      facilitiesDelete: 'estate.admin.facilities.delete',
      facilitiesBookingsView: 'estate.admin.facilities.bookings.view',
      facilitiesBookingsApprove: 'estate.admin.facilities.bookings.approve',
      facilitiesBookingsCancel: 'estate.admin.facilities.bookings.cancel',
    };

    // Get permission IDs
    const { data: permsData, error: permsError } = await supabase
      .from('permissions')
      .select('id, slug');

    if (permsError) throw permsError;

    // Get current role permissions
    const { data: currentPerms, error: currentError } = await supabase
      .from('role_permissions')
      .select('id, permission_id, permissions(slug)')
      .eq('role_id', params.roleId);

    if (currentError) throw currentError;

    // Build the set of permissions to keep
    const permissionsToKeep = new Set<string>();
    const permissionKey = body as { [key: string]: boolean };

    Object.entries(permissionKey).forEach(([key, enabled]) => {
      if (key in permissionMap && enabled) {
        const slug = permissionMap[key as keyof typeof permissionMap];
        permissionsToKeep.add(slug);
      }
    });

    // Remove permissions that should be removed
    const toDelete = (currentPerms ?? [])
      .filter((rp: any) => FACILITIES_PERMISSIONS.includes(rp.permissions.slug) && !permissionsToKeep.has(rp.permissions.slug))
      .map((rp: any) => rp.id);

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('role_permissions')
        .delete()
        .in('id', toDelete);

      if (deleteError) throw deleteError;
    }

    // Add new permissions
    const existingSlugs = new Set(
      (currentPerms ?? [])
        .filter((rp: any) => FACILITIES_PERMISSIONS.includes(rp.permissions.slug))
        .map((rp: any) => rp.permissions.slug)
    );

    const toAdd: { role_id: string; permission_id: string }[] = [];
    permissionsToKeep.forEach((slug) => {
      if (!existingSlugs.has(slug)) {
        const perm = (permsData ?? []).find((p: any) => p.slug === slug);
        if (perm) {
          toAdd.push({
            role_id: params.roleId,
            permission_id: perm.id,
          });
        }
      }
    });

    if (toAdd.length > 0) {
      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(toAdd);

      if (insertError) throw insertError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to update facilities RBAC');
  }
}
