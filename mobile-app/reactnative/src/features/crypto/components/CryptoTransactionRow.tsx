import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import CryptoStatusBadge from './CryptoStatusBadge';
import { formatFiatObj, relativeTime } from '../utils/cryptoFormatters';
import { SIDE_LABEL } from '../constants/crypto.constants';
import type { CryptoTransactionSummary } from '../types/crypto.types';

interface Props {
  tx: CryptoTransactionSummary;
  onPress?: () => void;
}

/** Buy/sell history row (docs/crypto/screens.md → crypto orders / transactions). */
export default function CryptoTransactionRow({ tx, onPress }: Props) {
  const isBuy = tx.side === 'buy';
  const Icon = isBuy ? ArrowDownLeft : ArrowUpRight;
  const sign = isBuy ? '−' : '+';     // buy debits fiat, sell credits fiat
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${SIDE_LABEL[tx.side]} ${tx.symbol}, ${formatFiatObj(tx.fiat)}, ${tx.status}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${tx.iconColor}1F` }]}>
        <Icon size={18} color={tx.iconColor} strokeWidth={2} />
      </View>

      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{SIDE_LABEL[tx.side]} {tx.symbol}</Text>
        <Text style={styles.sub} numberOfLines={1}>{relativeTime(tx.createdAt)} · {tx.reference}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.amount} numberOfLines={1}>{sign}{formatFiatObj(tx.fiat)}</Text>
        <CryptoStatusBadge status={tx.status} size="sm" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
});
