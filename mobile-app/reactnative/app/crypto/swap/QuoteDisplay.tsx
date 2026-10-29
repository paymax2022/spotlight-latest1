import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import type { SwapQuoteWire } from '@/features/crypto/types/swapWire';
import {
  secondsRemaining, countdownState, quoteLabel, expiryLabel,
} from '@/features/crypto/utils/swapDisplay';

interface Props {
  quote: SwapQuoteWire;
  onConfirm: () => void;
  onRefresh: () => void;
}

/** Quote review: amounts, live expiry countdown (red under 5s), Confirm or Get New Quote. */
export default function QuoteDisplay({ quote, onConfirm, onRefresh }: Props) {
  const [seconds, setSeconds] = useState(() => secondsRemaining(quote.expires_at));

  useEffect(() => {
    setSeconds(secondsRemaining(quote.expires_at));
    const id = setInterval(() => setSeconds(secondsRemaining(quote.expires_at)), 1000);
    return () => clearInterval(id);
  }, [quote.expires_at]);

  const state = countdownState(seconds);
  const expired = state === 'expired';

  return (
    <View style={styles.card}>
      <Text style={styles.label}>You swap</Text>
      <Text style={styles.amount}>{quoteLabel(quote.from_units, quote.from_asset_id)}</Text>
      <Text style={styles.label}>You receive</Text>
      <Text style={styles.amount}>{quoteLabel(quote.to_units, quote.to_asset_id)}</Text>
      <Text
        testID="countdown"
        accessibilityLiveRegion="polite"
        style={[styles.countdown, state !== 'normal' && { color: Colors.error }]}
      >
        {expiryLabel(seconds)}
      </Text>
      {expired
        ? <PrimaryButton label="Get New Quote" onPress={onRefresh} />
        : <PrimaryButton label="Confirm Swap" onPress={onConfirm} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  countdown: { ...Typography.labelLg, color: Colors.teal, marginBottom: Spacing.md },
});
