import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  payoutRef:   string;
  periodLabel: string;
  consultCount: number;
  amount:      string;           // pre-formatted (formatKobo, display only)
  statusLabel: string;
  statusTone:  string;           // token colour for the status pill
  failed?:     boolean;          // highlights the failed payout state
  onPress?:    () => void;
}

// New component (Y): a payout-history row (ref + period + amount + status pill +
// chevron) for the payout list and report. The earnings PayoutRow is local to
// (tabs)/earnings.tsx and typed to the Phase 1 PayoutItem; this row is reused by
// the payout-detail list / report over the richer PayoutDetail, with a visible
// failed state, so a shared row is justified.
export default function PayoutDetailRow({ payoutRef, periodLabel, consultCount, amount, statusLabel, statusTone, failed, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, failed && styles.rowFailed, pressed && !!onPress && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Payout ${payoutRef}, ${amount}, ${statusLabel}`}
    >
      <View style={styles.body}>
        <Text style={styles.ref} numberOfLines={1}>{payoutRef}</Text>
        <Text style={styles.meta} numberOfLines={1}>{periodLabel} · {consultCount} consults</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>{amount}</Text>
        <View style={[styles.pill, { backgroundColor: `${statusTone}1A` }]}>
          <Text style={[styles.pillText, { color: statusTone }]}>{statusLabel}</Text>
        </View>
      </View>
      {!!onPress && <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  rowFailed: { borderColor: Colors.error },
  pressed:   { opacity: 0.7 },
  body:      { flex: 1, gap: 2 },
  ref:       { ...Typography.labelLg, color: Colors.onSurface },
  meta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:     { alignItems: 'flex-end', gap: Spacing.xs },
  amount:    { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  pill:      { height: 24, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  pillText:  { ...Typography.labelSm, fontWeight: '700' },
});
