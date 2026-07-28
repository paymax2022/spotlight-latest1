// ── Paymax · Admin — KycCaseRow ──────────────────────────────────────────────
// One KYC queue case: name + requested tier, status pill, risk flags, submitted
// time. Pressable to drill into the case detail.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StatusPill from './StatusPill';
import { KYC_STATUS_STYLE, relativeTime } from '../constants/admin.constants';
import type { KycCase } from '../types/admin.types';

interface Props {
  item: KycCase;
  onPress?: () => void;
  last?: boolean;
}

export default function KycCaseRow({ item, onPress, last }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.border, pressed && styles.pressed]}
    >
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          Tier {item.tier} · {relativeTime(item.submittedAt)}
        </Text>
        {item.riskFlags.length ? (
          <Text style={styles.flags} numberOfLines={1}>⚑ {item.riskFlags.join(', ')}</Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <StatusPill status={item.status} styleMap={KYC_STATUS_STYLE} />
        <ChevronRight size={18} color={Colors.outline} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  pressed: { opacity: 0.6 },
  left: { flex: 1, gap: 2 },
  name: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  flags: { ...Typography.labelSm, color: Colors.onWarning },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
