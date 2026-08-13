export type Role = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  roleType?: string;
  isSystemRole?: boolean;
  isActive?: boolean;
  createdAt?: string;
};

export type Permission = {
  id: string;
  name: string;
  slug: string;
  module?: string;
  resource?: string;
  action?: string;
  description?: string;
  isSystemPermission?: boolean;
};

export type PermissionMatrix = {
  permissionSlugs: string[];
  rows: Array<{
    roleId: string;
    roleName: string;
    roleSlug: string;
    permissions: Record<string, boolean>;
  }>;
};
