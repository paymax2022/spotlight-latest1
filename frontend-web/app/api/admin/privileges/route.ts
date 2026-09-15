import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/privileges — Get privileges for all users
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    // Get all users with their roles and permissions
    const { data: usersData, error: usersError } = await supabase
      .from('auth.users')
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

    // Build module structure
    const moduleMap: { [key: string]: Set<string> } = {
      'estate.admin': new Set(),
      'platform': new Set(),
      'finance': new Set(),
      'marketplace': new Set(),
    };

    // Process user data with their permissions
    const result = (usersData ?? []).map((u: any) => {
      const modules: { [key: string]: { name: string; permissions: string[]; isActive: boolean } } = {};

      // Get roles for user
      const userRolesList = (userRoles ?? []).filter((ur: any) => ur.user_id === u.id);
      const roleIds = userRolesList.map((ur: any) => ur.role_id);

      // Get permissions from roles
      const rolePerms = (rolePermissions ?? [])
        .filter((rp: any) => roleIds.includes(rp.role_id))
        .map((rp: any) => rp.permissions.slug);

      // Get direct user permissions
      const directPerms = (userPermissions ?? [])
        .filter((up: any) => up.user_id === u.id)
        .map((up: any) => up.permissions.slug);

      // Combine permissions
      const allPerms = [...new Set([...rolePerms, ...directPerms])];

      // Organize by module
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
