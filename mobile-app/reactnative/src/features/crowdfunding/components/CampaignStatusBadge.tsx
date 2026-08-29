import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { CampaignStatus } from '../types/crowdfunding.types';

interface Props {
  status: CampaignStatus;
  size?: 'sm' | 'md';
  /**
   * Owner-paused. Rendered as a SECOND pill beside the real status rather than
   * replacing it: `paused` and `status` are orthogonal, and collapsing them
   * would hide a FROZEN fraud stop behind the friendlier word "Paused" —
   * exactly the campaign whose real state a reader most needs to see.
   */
  paused?: boolean;
}

// Pill-shaped status chips: high-contrast text on a 10% tint (per DESIGN-Mobile.md).
const MAP: Record<CampaignStatus, { label: string; fg: string; bg: string }> = {
  ACTIVE:         { label: 'Active',          fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  DRAFT:          { label: 'Draft',           fg: Colors.onSurfaceVariant,  bg: Colors.surfaceContainerHigh },
  PENDING_REVIEW: { label: 'Under review',    fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  COMPLETED:      { label: 'Completed',       fg: Colors.secondary,         bg: Colors.iconBgBlue },
  EXPIRED:        { label: 'Expired',         fg: Colors.onSurfaceVariant,  bg: Colors.surfaceContainerHigh },
  CANCELLED:      { label: 'Cancelled',       fg: Colors.onSurfaceVariant,  bg: Colors.surfaceContainerHigh },
  FROZEN:         { label: 'Frozen',          fg: Colors.error,             bg: Colors.iconBgRed },
  REJECTED:       { label: 'Rejected',        fg: Colors.error,             bg: Colors.iconBgRed },
};

const PAUSED_FG = '#B65A00';

export default function CampaignStatusBadge({ status, size = 'md', paused }: Props) {
  const { label, fg, bg } = MAP[status];
  return (
    <View style={styles.group}>
      <View style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: bg }]}>
        <View style={[styles.dot, { backgroundColor: fg }]} />
        <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: fg }]}>{label}</Text>
      </View>
      {paused ? (
        <View
          style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: Colors.iconBgOrange }]}
          accessibilityLabel={`Paused, and ${label.toLowerCase()}`}
        >
          <View style={[styles.dot, { backgroundColor: PAUSED_FG }]} />
          <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: PAUSED_FG }]}>Paused</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    alignSelf: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});
