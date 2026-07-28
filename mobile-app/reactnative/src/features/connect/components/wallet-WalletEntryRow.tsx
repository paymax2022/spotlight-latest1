import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import MoneyAmount from './wallet-MoneyAmount';
import type { WalletEntry } from '../wallet/types';

interface Props {
  entry: WalletEntry;
  onPress?: () => void;
}

const ICON: Record<WalletEntry['kind'], string> = {
  fund: 'Plus',
  gift_sent: 'Gift',
  gift_received: 'Gift',
  payout: 'Banknote',
  boost: 'Sparkles',
  refund: 'ArrowDownLeft',
  reversal: 'ArrowDownLeft',
};

const STATUS_LABEL: Record<WalletEntry['status'], string> = {
  completed: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
  reversed: 'Reversed',
};

function statusColor(s: WalletEntry['status']): string {
  if (s === 'completed') return Colors.teal;
  if (s === 'pending') return Colors.gold;
  return Colors.error;
}

/** Ledger-style line item: icon, title + status, signed amount. */
export default function WalletEntryRow({ entry, onPress }: Props) {
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[ICON[entry.kind]] ?? Icons.Receipt;
  const credit = entry.direction === 'credit';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.iconBox, { backgroundColor: credit ? Colors.iconBgTeal : Colors.iconBgPurple }]}>
        <Icon size={18} color={credit ? Colors.teal : Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{entry.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          <Text style={{ color: statusColor(entry.status) }}>{STATUS_LABEL[entry.status]}</Text>
          {entry.note ? ` · ${entry.note}` : ''}
        </Text>
      </View>
      <MoneyAmount kobo={entry.amountKobo} direction={entry.direction} size="sm" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  pressed: { opacity: 0.6 },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
