import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { FEE_LABEL, RAIL_LABEL } from '../constants/fx.constants';
import { formatMoneyObj, formatRate } from '../utils/fxFormatters';
import type { Quote } from '../types/fx.types';

interface Props {
  quote: Quote;
  showRoute?: boolean;     // optional route note (spec C/D)
}

/**
 * All-in rate + itemized fee/spread transparency line (spec §5.2, §9).
 * Every fee is shown explicitly so the customer sees exactly what they pay.
 */
export default function QuoteBreakdown({ quote, showRoute }: Props) {
  return (
    <View style={styles.card}>
      <Row label="Exchange rate" value={formatRate(quote.source.currency, quote.destination.currency, quote.rate)} />
      <Row
        label="All-in rate"
        value={formatRate(quote.source.currency, quote.destination.currency, quote.allInRate)}
        emphasis
      />

      <View style={styles.divider} />

      {quote.fees
        .filter((f) => f.amount.amount > 0)
        .map((f) => (
          <Row key={f.type} label={FEE_LABEL[f.type] ?? f.type} value={formatMoneyObj(f.amount)} muted />
        ))}
      {quote.fees.every((f) => f.amount.amount === 0) ? (
        <Row label="Fees" value="No fees" muted />
      ) : null}

      <View style={styles.divider} />

      <Row label="You send" value={formatMoneyObj(quote.source)} />
      <Row label="Recipient gets" value={formatMoneyObj(quote.destination)} emphasis />

      {showRoute ? (
        <View style={styles.routeNote}>
          <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.routeText}>
            Routed via {RAIL_LABEL[quote.route.rail]} on the {quote.route.corridor} corridor for the best all-in rate.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, emphasis, muted }: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, muted && styles.muted]}>{label}</Text>
      <Text style={[styles.value, emphasis && styles.emphasis, muted && styles.mutedValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...Typography.bodyMd, color: Colors.onSurface },
  value: { ...Typography.labelLg, color: Colors.onSurface },
  emphasis: { color: Colors.primary },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mutedValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  routeNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceContainer, borderRadius: Radius.md,
    padding: Spacing.sm, marginTop: 2,
  },
  routeText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
