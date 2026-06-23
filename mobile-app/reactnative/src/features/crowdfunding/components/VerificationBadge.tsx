import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import type { VerificationLevel } from '../types/crowdfunding.types';

interface Props {
  level: VerificationLevel;
  /** icon-only renders just the check (for inline use next to a name). */
  variant?: 'icon' | 'chip';
  size?: number;
}

const LABEL: Record<VerificationLevel, string> = {
  UNVERIFIED: 'Unverified',
  EMAIL: 'Email verified',
  KYC: 'ID verified',
  KYB: 'Business verified',
  FULL: 'Fully verified',
};

export default function VerificationBadge({ level, variant = 'chip', size = 16 }: Props) {
  if (level === 'UNVERIFIED') {
    if (variant === 'icon') return null;
    return (
      <View style={[styles.chip, styles.chipMuted]}>
        <ShieldCheck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.labelMuted}>Unverified</Text>
      </View>
    );
  }

  if (variant === 'icon') {
    return <BadgeCheck size={size} color={Colors.secondary} strokeWidth={2.2} accessibilityLabel={LABEL[level]} />;
  }

  return (
    <View style={styles.chip}>
      <BadgeCheck size={13} color={Colors.secondary} strokeWidth={2.2} />
      <Text style={styles.label}>{LABEL[level]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgBlue,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  chipMuted: { backgroundColor: Colors.surfaceContainerHigh },
  label: { ...Typography.caption, color: Colors.secondary, fontWeight: '600' as const },
  labelMuted: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
});
