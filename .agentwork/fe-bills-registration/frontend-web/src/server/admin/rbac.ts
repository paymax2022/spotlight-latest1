export type AdminRole =
  | 'super_admin'
  | 'program_manager'
  | 'contest_manager'
  | 'voting_manager'
  | 'finance_admin'
  | 'finance_maker'    // Block 9: can initiate wallet adjustments
  | 'finance_checker'  // Block 9: can approve/reject adjustments (no self-approval)
  | 'finance_viewer'   // Block 9: read-only view of adjustments
  | 'content_manager'
  | 'media_manager'
  | 'sponsor_manager'
  | 'judge'
  | 'reviewer'
  | 'event_manager'
  | 'support_agent'
  | 'auditor'
  | 'executive_readonly';

export type AdminPermission =
  | 'dashboard:view'
  | 'programs:manage'
  | 'contests:manage'
  | 'applications:review'
  | 'scores:manage'
  | 'votes:manage'
  | 'finance:view'
  | 'finance:refund'
  | 'finance:adjust:initiate'   // Block 9: propose a manual credit/debit
  | 'finance:adjust:approve'    // Block 9: approve/reject another user's adjustment
  | 'utility:manage'
  | 'utility:support'
  | 'content:manage'
  | 'reports:export'
  | 'users:manage'
  | 'roles:manage'
  | 'audit:view';

const rolePermissions: Record<AdminRole, AdminPermission[]> = {
  super_admin: [
    'dashboard:view','programs:manage','contests:manage','applications:review','scores:manage','votes:manage',
    'finance:view','finance:refund','content:manage','reports:export','users:manage','roles:manage','audit:view',
    'utility:manage','utility:support',
  ],
  program_manager: ['dashboard:view', 'programs:manage', 'applications:review', 'reports:export'],
  contest_manager: ['dashboard:view', 'contests:manage', 'applications:review', 'scores:manage', 'votes:manage', 'reports:export'],
  voting_manager: ['dashboard:view', 'scores:manage', 'votes:manage', 'reports:export'],
  finance_admin: [
    'dashboard:view', 'finance:view', 'finance:refund',
    'finance:adjust:initiate', 'finance:adjust:approve',
    'utility:manage', 'utility:support', 'reports:export', 'audit:view',
  ],
  finance_maker:  ['dashboard:view', 'finance:view', 'finance:adjust:initiate', 'audit:view'],
  finance_checker: ['dashboard:view', 'finance:view', 'finance:adjust:approve', 'audit:view'],
  finance_viewer:  ['dashboard:view', 'finance:view', 'audit:view'],
  content_manager: ['dashboard:view', 'content:manage'],
  media_manager: ['dashboard:view', 'content:manage'],
  sponsor_manager: ['dashboard:view', 'programs:manage', 'reports:export'],
  judge: ['dashboard:view', 'scores:manage'],
  reviewer: ['dashboard:view', 'applications:review', 'scores:manage'],
  event_manager: ['dashboard:view', 'programs:manage'],
  support_agent: ['dashboard:view', 'applications:review', 'utility:support'],
  auditor: ['dashboard:view', 'audit:view', 'utility:support', 'reports:export'],
  executive_readonly: ['dashboard:view', 'finance:view', 'audit:view', 'utility:support'],
};

export function parseAdminRole(input: string | null | undefined): AdminRole {
  if (!input) return 'executive_readonly';
  const normalized = input.trim().toLowerCase();
  const aliasMap: Record<string, AdminRole> = {
    admin: 'super_admin',
    operations_manager: 'program_manager',
  };
  const mapped = (aliasMap[normalized] || normalized) as AdminRole;
  return mapped in rolePermissions ? mapped : 'executive_readonly';
}

export function hasPermission(role: AdminRole, permission: AdminPermission) {
  return rolePermissions[role]?.includes(permission) ?? false;
}
