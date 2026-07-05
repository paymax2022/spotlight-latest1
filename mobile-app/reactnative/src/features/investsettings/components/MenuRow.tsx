import React from 'react';
import ProfileMenuItem from '@/components/ProfileMenuItem';

interface Props {
  icon: string;
  iconColor?: string;
  bgColor?: string;
  label: string;
  value?: string;
  danger?: boolean;
  onPress: () => void;
  showChevron?: boolean;
}

/**
 * Settings menu row. Thin wrapper over the shared ProfileMenuItem so the
 * invest-settings screens have a module-local name to import (and a single place
 * to adjust menu-row behaviour later) while reusing the canonical component.
 */
export default function MenuRow(props: Props) {
  return <ProfileMenuItem {...props} />;
}
