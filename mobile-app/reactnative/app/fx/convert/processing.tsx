import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useExecuteConversion } from '@/features/fx/hooks/useFx';
import { buildQuote } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function ConvertProcessingScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; amount: string; amountType: string; expiresAt: string }>();
  const from = params.from as CurrencyCode;
  const to = params.to as CurrencyCode;
  const amount = Number(params.amount);
  const amountType = (params.amountType as 'source' | 'destination') ?? 'source';
  const convert = useExecuteConversion();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const quote = buildQuote({ source: from, destination: to, amount, amountType, intent: 'conversion', lock: true });
    // Preserve the (possibly already-expired) lock window from the review screen.
    if (params.expiresAt) quote.expiresAt = String(params.expiresAt);

    convert.mutate(quote, {
      onSuccess: (res) => {
        router.replace({
          pathname: '/fx/convert/success',
          params: {
            reference: res.reference,
            from, to,
            source: String(res.source.amount),
            dest: String(res.destination.amount),
            txId: res.transactionId,
          },
        });
      },
      onError: (err: unknown) => {
        const e = err as { fxType?: string; message?: string };
        router.replace({
          pathname: '/fx/convert/failed',
          params: {
            from, to, amount: String(amount), amountType,
            reason: e?.fxType === 'rate_expired'
              ? 'The locked rate expired before the conversion completed. Please request a fresh quote.'
              : (e?.message ?? 'The conversion could not be completed. No funds were moved.'),
            kind: e?.fxType === 'rate_expired' ? 'rate_expired' : 'error',
          },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
        <Text style={styles.title}>Converting your money…</Text>
        <Text style={styles.sub}>Securing the locked rate and posting to your ledger. This only takes a moment.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
