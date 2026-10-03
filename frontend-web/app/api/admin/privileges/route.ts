import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/privileges — Get privileges for all users
// E2E-SEC-054: was gated on requireRequestUser only — any signed-in user could
// enumerate every user's role/permission assignments. RBAC inventory is
// roles:manage territory, same as /api/admin/users-roles.
//
// Residual fix: the user list read `.from('auth.users')`, which PostgREST does
// not expose → every gated call 500'd. public.user_profiles carries the same
// id + email columns and is the store every other BFF route reads.
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'roles:manage');
    const supabase = createAdminClient();

    const { data: usersData, error: usersError } = await supabase
      .from('user_profiles')
      .select(`
        id,
        email
      `)
      .limit(100);

    if (usersError) throw usersError;

    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select(`
        user_id,
        role_id,
        roles(name, id)
      `);

    if (rolesError) throw rolesError;

    const { data: rolePermissions, error: permError } = await supabase
      .from('role_permissions')
      .select(`
        role_id,
        permission_id,
        permissions(slug, name)
      `);

    if (permError) throw permError;

    const { data: userPermissions, error: userPermError } = await supabase
      .from('user_permissions')
      .select(`
        user_id,
        permission_id,
        permissions(slug, name)
      `);

    if (userPermError) throw userPermError;

    const moduleMap: { [key: string]: Set<string> } = {
      'estate.admin': new Set(),
      'platform': new Set(),
      'finance': new Set(),
      'marketplace': new Set(),
    };

    const result = (usersData ?? []).map((u: any) => {
      const modules: { [key: string]: { name: string; permissions: string[]; isActive: boolean } } = {};

      const userRolesList = (userRoles ?? []).filter((ur: any) => ur.user_id === u.id);
      const roleIds = userRolesList.map((ur: any) => ur.role_id);

      const rolePerms = (rolePermissions ?? [])
        .filter((rp: any) => roleIds.includes(rp.role_id))
        .map((rp: any) => rp.permissions.slug);

      const directPerms = (userPermissions ?? [])
        .filter((up: any) => up.user_id === u.id)
        .map((up: any) => up.permissions.slug);

      const allPerms = [...new Set([...rolePerms, ...directPerms])];

      Object.keys(moduleMap).forEach((mod) => {
        const modPerms = allPerms.filter((p: string) => p.startsWith(mod));
        modules[mod] = {
          name: mod,
          permissions: modPerms,
          isActive: modPerms.length > 0,
        };
      });

      return {
        userId: u.id,
        userName: u.email?.split('@')[0] || 'Unknown',
        userEmail: u.email || '',
        modules,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to get privileges');
  }
}
