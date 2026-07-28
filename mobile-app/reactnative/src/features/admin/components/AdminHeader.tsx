// ── Paymax · Admin — AdminHeader ─────────────────────────────────────────────
// Shared screen header (back arrow + title) with a role chip in the right slot
// showing the currently-selected admin role. Composes the shared ScreenHeader.

import React from 'react';
import ScreenHeader from '@/components/ScreenHeader';
import RoleBadge from './RoleBadge';
import { useAdminRole } from '../context/AdminRole';

interface Props {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Hide the role chip (e.g. on the settings screen where it's redundant). */
  hideRole?: boolean;
}

export default function AdminHeader({ title, subtitle, showBack = true, onBack, hideRole }: Props) {
  const { role } = useAdminRole();
  return (
    <ScreenHeader
      title={title}
      subtitle={subtitle}
      showBack={showBack}
      onBack={onBack}
      rightSlot={hideRole ? undefined : <RoleBadge role={role} />}
    />
  );
}
