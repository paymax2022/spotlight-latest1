import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { PAYOUT_FREQ_LABEL } from '../constants';
import { calcReturns, formatNaira, formatYield } from '../utils';
import { sanitizeMoneyInput } from '@/utils/money';
import type { OfferingDetail, OfferingSummary } from '../types';

interface Props {
  offering: OfferingSummary | OfferingDetail;
  /** Optional fixed amount (kobo); when omitted the user types one. */
  initialAmountKobo?: number;
  editable?: boolean;
}

/** Returns preview. CLIENT ESTIMATE only — backend confirms actual payouts. */
export default function ReturnsCalculator({ offering, initialAmountKobo, editable = true }: Props) {
  const [naira, setNaira] = useState(String((initialAmountKobo ?? offering.unitPriceKobo * (offering.minUnits || 1)) / 100));
  const amountKobo = Math.max(0, Math.round((parseFloat(naira) || 0) * 100));

  const result = useMemo(() => calcReturns({
    amountKobo,
    projectedYieldBps: offering.projectedYieldBps,
    tenorMonths: offering.tenorMonths,
    payoutFrequency: offering.payoutFrequency,
  }), [amountKobo, offering]);

  return (
    <View style={styles.wrap}>
      {editable ? (
        <View style={styles.inputBlock}>
          <Text style={styles.inputLabel}>Investment amount</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>₦</Text>
            <TextInput
              value={naira}
              onChangeText={(t) => setNaira(sanitizeMoneyInput(t))}
              keyboardType="decimal-pad"
              maxLength={13}
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Colors.onSurfaceVariant}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.rows}>
        <Row label="Projected yield" value={`${formatYield(offering.projectedYieldBps)} p.a.`} />
        <Row label={`Payout (${PAYOUT_FREQ_LABEL[offering.payoutFrequency].toLowerCase()})`}
          value={formatNaira(result.periodicPayoutKobo)} />
        <Row label="Total projected income" value={formatNaira(result.totalIncomeKobo)} accent />
        <Row label="Projected value at exit" value={formatNaira(result.projectedExitKobo)} accent />
      </View>

      <Text style={styles.disclaimer}>
        Estimate only. Projected returns are not guaranteed and your capital is at risk.
      </Text>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowVal, accent && styles.rowValAccent]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  inputBlock: { gap: 6 },
  inputLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  currency: { ...Typography.titleLg, color: Colors.onSurface, marginRight: 4 },
  input: { ...Typography.titleLg, color: Colors.onSurface, flex: 1, paddingVertical: Spacing.md },
  rows: { gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.labelLg, color: Colors.onSurface },
  rowValAccent: { color: Colors.primary },
  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
});
