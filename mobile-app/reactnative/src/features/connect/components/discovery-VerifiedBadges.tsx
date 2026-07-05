import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck, ShieldCheck, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ConnectColors } from '../constants/connect.constants';
import type { VerificationFlag } from '../discovery/types';

const META: Record<VerificationFlag, { label: string; Icon: typeof BadgeCheck }> = {
  selfie: { label: 'Selfie verified', Icon: BadgeCheck },
  identity: { label: 'ID verified', Icon: ShieldCheck },
  photo: { label: 'Photo verified', Icon: Camera },
};

interface Props {
  flags: VerificationFlag[];
  size?: 'sm' | 'md';
}

/**
 * Verification badge row (PRD §10.2 / §10.4 verify badges). Shared so the card
 * stack, profile detail and unified-profile badges screen render identical
 * trust signals. When `flags` is empty renders a muted "Not yet verified" pill.
 */
export default function DiscoveryVerifiedBadges({ flags, size = 'md' }: Props) {
  if (!flags.length) {
    return (
      <View style={styles.row}>
        <View style={[styles.pill, styles.pillMuted]}>
          <Text style={styles.pillMutedText}>Not yet verified</Text>
        </View>
      </View>
    );
  }
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <View style={styles.row}>
      {flags.map((flag) => {
        const meta = META[flag];
        const Icon = meta.Icon;
        return (
          <View key={flag} style={styles.pill}>
            <Icon size={iconSize} color={ConnectColors.ok} strokeWidth={2.4} />
            <Text style={[styles.pillText, size === 'sm' && styles.pillTextSm]}>{meta.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ConnectColors.okBg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  pillText: { ...Typography.labelSm, color: ConnectColors.ok },
  pillTextSm: { ...Typography.caption, color: ConnectColors.ok },
  pillMuted: { backgroundColor: Colors.surfaceContainerHigh },
  pillMutedText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
