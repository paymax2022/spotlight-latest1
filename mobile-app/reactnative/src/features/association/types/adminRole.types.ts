// ── Association — Admin RBAC & member-action contract (Q depth) ────────────────

export type AdminRole =
  | 'NONE'
  | 'CHAPTER_ADMIN'
  | 'FINANCE_ADMIN'
  | 'SECRETARY'
  | 'NATIONAL_ADMIN'
  | 'SUPER_ADMIN';

export interface AdminAccess {
  isAdmin:      boolean;
  role:         AdminRole;
  roleLabel:    string;
  jurisdiction: 'CHAPTER' | 'NATIONAL' | 'GLOBAL';
  /**
   * The organisation this admin administers, when the DTO reports it. Every
   * org-scoped admin call is scoped with this — the client never guesses an
   * org id.
   */
  organisationId?: string | null;
  /** Display name for that organisation, when the DTO reports it. */
  organisationName?: string | null;
  /** Coarse capability flags the UI gates on. */
  can: {
    approveMembers: boolean;
    manageMembers:  boolean;     // suspend/restore/transfer/assign-role
    manageFinance:  boolean;
    importMembers:  boolean;
  };
}

export type MemberAdminAction = 'SUSPEND' | 'RESTORE' | 'TRANSFER' | 'ASSIGN_ROLE';

export interface MemberActionResult {
  ok: true;
}

/** Roles that can be assigned to a member from the admin member screen. */
export const ASSIGNABLE_ROLES: { value: AdminRole; label: string }[] = [
  { value: 'NONE', label: 'Member (no admin role)' },
  { value: 'SECRETARY', label: 'Secretary' },
  { value: 'FINANCE_ADMIN', label: 'Finance admin' },
  { value: 'CHAPTER_ADMIN', label: 'Chapter admin' },
];
