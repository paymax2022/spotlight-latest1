import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CRYPTO_FEE_LABEL } from '../constants/crypto.constants';
import { formatCrypto, formatFiatObj, formatPrice } from '../utils/cryptoFormatters';
import type { CryptoQuote } from '../types/crypto.types';

interface Props {
  quote: CryptoQuote;
  decimals: number;        // asset precision for the crypto amount line
}

/**
 * Itemised order summary + fee transparency for the trade-confirmation screen
 * (docs/crypto/CLAUDE.md → every trade-confirmation screen must show fees +
 * order summary). Every fee is shown explicitly — "never hide fees".
 */
export default function CryptoQuoteBreakdown({ quote, decimals }: Props) {
  const buy = quote.side === 'buy';
  return (
    <View style={styles.card}>
      <Row label="Price" value={formatPrice(quote.symbol, quote.allInRate)} />
      <Row label={buy ? 'You receive' : 'You sell'} value={formatCrypto(quote.crypto.amount, quote.symbol, decimals)} emphasis />

      <View style={styles.divider} />

      {quote.fees
        .filter((f) => f.amount.amount > 0)
        .map((f) => (
          <Row key={f.type} label={CRYPTO_FEE_LABEL[f.type] ?? f.type} value={formatFiatObj(f.amount)} muted />
        ))}

      <View style={styles.divider} />

      <Row
        label={buy ? 'Total to pay' : 'Total you get'}
        value={formatFiatObj(quote.totalFiat)}
        emphasis
      />

      <View style={styles.routeNote}>
        <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.routeText}>
          Filled at the locked price by our liquidity partner. The final amount can vary slightly if you re-quote after expiry.
        </Text>
      </View>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1 },
  value: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
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
