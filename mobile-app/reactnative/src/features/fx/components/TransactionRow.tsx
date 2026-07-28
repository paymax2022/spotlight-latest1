import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeftRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TxStatusBadge from './TxStatusBadge';
import { formatMoneyObj, relativeTime } from '../utils/fxFormatters';
import type { TransactionSummary } from '../types/fx.types';

interface Props {
  tx: TransactionSummary;
  onPress?: () => void;
}

/** Single unified-ledger transaction row (spec H → Transaction list). */
export default function TransactionRow({ tx, onPress }: Props) {
  const out = tx.direction === 'out';
  const Icon = tx.type === 'conversion' ? ArrowLeftRight : out ? ArrowUpRight : ArrowDownLeft;
  const shown = tx.type === 'conversion' ? tx.destination : out ? tx.source : tx.destination;
  const sign = tx.type === 'conversion' ? '' : out ? '−' : '+';
  const amountColor = tx.type === 'conversion' ? Colors.onSurface : out ? Colors.onSurface : Colors.teal;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tx.title}, ${formatMoneyObj(shown)}, ${tx.status}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, out ? styles.iconOut : styles.iconIn]}>
        <Icon size={18} color={out ? Colors.secondary : Colors.teal} strokeWidth={2} />
      </View>

      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{tx.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{relativeTime(tx.createdAt)} · {tx.reference}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
          {sign}{formatMoneyObj(shown)}
        </Text>
        <TxStatusBadge status={tx.status} size="sm" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconIn: { backgroundColor: Colors.iconBgTeal },
  iconOut: { backgroundColor: Colors.iconBgBlue },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg },
});
