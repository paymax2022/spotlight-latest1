// ── Paymax · Admin — WithdrawalReviewRow ─────────────────────────────────────
// One withdrawal awaiting review: user + amount, masked address/network, risk
// chip + status. Pressable to open the review (approve/reject) detail.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StatusPill from './StatusPill';
import {
  WITHDRAWAL_STATUS_STYLE,
  formatMoneyObj,
  maskMiddle,
  relativeTime,
  riskChip,
} from '../constants/admin.constants';
import type { WithdrawalReviewItem } from '../types/admin.types';

interface Props {
  item: WithdrawalReviewItem;
  onPress?: () => void;
  last?: boolean;
}

export default function WithdrawalReviewRow({ item, onPress, last }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.border, pressed && styles.pressed]}
    >
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {formatMoneyObj(item.amount)} · {item.user}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.network} · {maskMiddle(item.address)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.reference} · {relativeTime(item.createdAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <StatusPill chip={riskChip(item.riskScore)} />
        <StatusPill status={item.status} styleMap={WITHDRAWAL_STATUS_STYLE} />
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
  title: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
});
