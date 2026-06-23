import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TxStatusBadge from './TxStatusBadge';
import { formatMoney, relativeTime } from '../utils/fxFormatters';
import type { CardTransaction } from '../types/fx.types';

interface Props {
  tx: CardTransaction;
}

/** Card-transaction row, incl. declined state with inline reason (spec F). */
export default function CardTransactionRow({ tx }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[tx.icon] ?? Icons.CreditCard;
  const declined = tx.status === 'declined';
  const refunded = tx.status === 'refunded';
  const amountColor = declined ? Colors.onSurfaceVariant : refunded ? Colors.teal : Colors.onSurface;

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${tx.merchant}, ${formatMoney(tx.amount, tx.currency)}, ${tx.status}`}
    >
      <View style={[styles.iconBox, declined && styles.iconDeclined]}>
        <Icon size={18} color={declined ? Colors.error : Colors.secondary} strokeWidth={2} />
      </View>

      <View style={styles.mid}>
        <Text style={styles.merchant} numberOfLines={1}>{tx.merchant}</Text>
        <Text style={styles.sub} numberOfLines={1}>{tx.category} · {relativeTime(tx.createdAt)}</Text>
        {declined && tx.declineReason ? <Text style={styles.declineReason} numberOfLines={2}>{tx.declineReason}</Text> : null}
      </View>

      <View style={styles.right}>
        <Text
          style={[styles.amount, { color: amountColor }, declined && styles.struck]}
          numberOfLines={1}
        >
          {refunded ? '+' : '−'}{formatMoney(tx.amount, tx.currency)}
        </Text>
        <TxStatusBadge status={tx.status} size="sm" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  iconDeclined: { backgroundColor: Colors.iconBgRed },
  mid: { flex: 1 },
  merchant: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  declineReason: { ...Typography.labelSm, color: Colors.error, marginTop: 3 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg },
  struck: { textDecorationLine: 'line-through' },
});
