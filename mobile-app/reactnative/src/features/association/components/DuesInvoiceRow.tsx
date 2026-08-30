import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { InvoiceStatusBadge } from './MembershipStatusBadge';
import { formatNaira, dueLabel, formatDate } from '../utils/associationFormatters';
import { CADENCE_LABEL } from '../constants/association.constants';
import type { DuesInvoice } from '../types/association.types';

interface Props {
  invoice: DuesInvoice;
  onPress: () => void;
}

const SCOPE_LABEL: Record<DuesInvoice['scope'], string> = {
  NATIONAL: 'National', STATE: 'State chapter', LOCAL: 'Local chapter', COMMITTEE: 'Committee',
};

export default function DuesInvoiceRow({ invoice: inv, onPress }: Props) {
  const payable = inv.status === 'DUE' || inv.status === 'OVERDUE';
  const cadence = CADENCE_LABEL[inv.cadence];

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.topRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{inv.title}</Text>
          <Text style={styles.scope}>{SCOPE_LABEL[inv.scope]}</Text>
        </View>
        <InvoiceStatusBadge status={inv.status} size="sm" />
      </View>

      <View style={styles.amountRow}>
        <Text style={styles.amount}>
          {formatNaira(inv.amountKobo)}
          {inv.cadence !== 'ONE_OFF' && inv.cadence !== 'LIFETIME' ? (
            <Text style={styles.cadence}> {cadence}</Text>
          ) : null}
        </Text>
        {/*
          `dueDate` is nullable — an event-registration invoice has none — so
          both branches tolerate it rather than printing the epoch.
        */}
        <Text style={[styles.due, inv.status === 'OVERDUE' && styles.dueOverdue]}>
          {inv.status === 'PAID'
            ? (inv.dueDate ? `Paid · ${formatDate(inv.dueDate)}` : 'Paid')
            : dueLabel(inv.dueDate)}
        </Text>
      </View>

      {payable ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Pay ${inv.title}, ${formatNaira(inv.amountKobo)}`}
          style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
        >
          <Text style={styles.payLabel}>Pay now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  titleWrap: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  scope: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.sm },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  cadence: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  due: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dueOverdue: { color: Colors.error, fontWeight: '600' as const },
  payBtn: {
    height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  payLabel: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
});
