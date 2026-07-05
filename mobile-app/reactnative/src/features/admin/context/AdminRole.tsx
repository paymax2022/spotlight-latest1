// ── Paymax · Admin Console — Role context ────────────────────────────────────
// Holds the currently-selected admin Role (default 'SuperAdmin'). The setter
// also pushes the role into the api module so every LIVE request attaches it as
// the `X-Admin-Role` header. Screens read the role via useAdminRole() to gate
// action buttons (client-side; the server is always authoritative).

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { setAdminRole } from '../api/admin.api';
import type { Role } from '../types/admin.types';

interface AdminRoleValue {
  role: Role;
  setRole: (role: Role) => void;
}

const AdminRoleContext = createContext<AdminRoleValue | undefined>(undefined);

const DEFAULT_ROLE: Role = 'SuperAdmin';

export function AdminRoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);

  // Keep the api module's role in sync on first mount (covers the default).
  React.useEffect(() => {
    setAdminRole(DEFAULT_ROLE);
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    setAdminRole(next); // attach to subsequent live X-Admin-Role headers
  }, []);

  const value = useMemo<AdminRoleValue>(() => ({ role, setRole }), [role, setRole]);

  return <AdminRoleContext.Provider value={value}>{children}</AdminRoleContext.Provider>;
}

/** Read the current admin role + setter. Throws if used outside the provider. */
export function useAdminRole(): AdminRoleValue {
  const ctx = useContext(AdminRoleContext);
  if (!ctx) throw new Error('useAdminRole must be used within an AdminRoleProvider');
  return ctx;
}
