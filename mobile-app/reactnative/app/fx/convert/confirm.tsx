import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import QuoteBreakdown from '@/features/fx/components/QuoteBreakdown';
import RateLockCountdown from '@/features/fx/components/RateLockCountdown';
import { buildQuote, formatMoney } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode, Quote } from '@/features/fx/types/fx.types';

export default function ConvertConfirmScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; amount: string; amountType: string }>();
  const from = params.from as CurrencyCode;
  const to = params.to as CurrencyCode;
  const amount = Number(params.amount);
  const amountType = (params.amountType as 'source' | 'destination') ?? 'source';

  const makeQuote = useCallback(
    (): Quote => buildQuote({ source: from, destination: to, amount, amountType, intent: 'conversion', lock: true }),
    [from, to, amount, amountType],
  );

  const [quote, setQuote] = useState<Quote>(makeQuote);
  const [expired, setExpired] = useState(false);

  const reQuote = () => { setQuote(makeQuote()); setExpired(false); };

  const confirm = () => {
    if (expired) { reQuote(); return; }
    router.push({
      pathname: '/fx/convert/processing',
      params: { from, to, amount: String(amount), amountType, expiresAt: quote.expiresAt },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review conversion" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <RateLockCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>You convert</Text>
          <Text style={styles.heroAmount}>{formatMoney(quote.source.amount, from)}</Text>
          <Text style={styles.heroArrow}>↓</Text>
          <Text style={styles.heroLabel}>You receive</Text>
          <Text style={[styles.heroAmount, styles.heroReceive]}>{formatMoney(quote.destination.amount, to)}</Text>
        </View>

        <QuoteBreakdown quote={quote} showRoute />

        <View style={styles.note}>
          <ShieldCheck size={15} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.noteText}>
            Funds move between your {from} and {to} wallets instantly at the locked rate. This action posts to your ledger and cannot be reversed.
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {expired ? (
          <PrimaryButton label="Rate expired — get new quote" onPress={reQuote} />
        ) : (
          <PrimaryButton label="Confirm conversion" onPress={confirm} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  heroCard: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingVertical: Spacing.lg, gap: 4,
  },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroReceive: { color: Colors.primary },
  heroArrow: { ...Typography.titleLg, color: Colors.outline, marginVertical: 2 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
