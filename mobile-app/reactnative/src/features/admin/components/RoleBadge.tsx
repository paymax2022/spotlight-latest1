// ── Paymax · Admin — RoleBadge ───────────────────────────────────────────────
// Colour-coded chip for an admin Role, driven by ROLE_STYLE / ROLE_LABEL.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { ROLE_LABEL, ROLE_STYLE } from '../constants/admin.constants';
import type { Role } from '../types/admin.types';

interface Props {
  role: Role;
}

export default function RoleBadge({ role }: Props) {
  const style = ROLE_STYLE[role];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.label, { color: style.fg }]} numberOfLines={1}>
        {ROLE_LABEL[role]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  label: { ...Typography.labelSm },
});
