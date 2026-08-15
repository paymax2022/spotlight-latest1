import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useBeneficiaries, useExecuteTransfer } from '@/features/fx/hooks/useFx';
import type { CurrencyCode, Quote } from '@/features/fx/types/fx.types';

export default function SendProcessingScreen() {
  const p = useLocalSearchParams<{ beneficiaryId: string; source: string; amount: string; narration: string; quote: string }>();
  const { data: beneficiaries } = useBeneficiaries();
  const transfer = useExecuteTransfer();
  const fired = useRef(false);

  const source = p.source as CurrencyCode;
  const amount = Number(p.amount);

  useEffect(() => {
    if (fired.current) return;
    const beneficiary = beneficiaries?.find((b) => b.id === p.beneficiaryId);
    if (!beneficiary) return;            // wait for beneficiary list to resolve
    fired.current = true;

    // The SERVER quote priced+locked on the review screen; the backend executes
    // against its id — no client-side quote math on this path.
    let quote: Quote | null = null;
    try { quote = p.quote ? (JSON.parse(String(p.quote)) as Quote) : null; } catch { quote = null; }
    if (!quote) {
      router.replace({
        pathname: '/fx/send/failed',
        params: {
          beneficiaryId: beneficiary.id, source, amount: String(amount), narration: p.narration ?? '',
          reason: 'The quote was lost in transit. Please request a fresh quote.', kind: 'rate_expired',
        },
      });
      return;
    }

    transfer.mutate(
      { draft: { beneficiaryId: beneficiary.id, beneficiary: null, source, amount, narration: p.narration || null, reference: null }, quote, beneficiary },
      {
        onSuccess: (res) => {
          router.replace({ pathname: '/fx/send/success', params: { reference: res.reference, txId: res.transactionId, name: beneficiary.name, dest: String(res.destination?.amount ?? 0), destCur: beneficiary.currency } });
        },
        onError: (err: unknown) => {
          const e = err as { fxType?: string; message?: string };
          router.replace({
            pathname: '/fx/send/failed',
            params: {
              beneficiaryId: beneficiary.id, source, amount: String(amount), narration: p.narration ?? '',
              reason: e?.fxType === 'rate_expired'
                ? 'The locked rate expired before the payout was sent. Please request a fresh quote.'
                : (e?.message ?? 'The payout could not be completed. Your balance was not debited.'),
              kind: e?.fxType === 'rate_expired' ? 'rate_expired' : 'error',
            },
          });
        },
      },
    );
  }, [beneficiaries]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
        <Text style={styles.title}>Sending your payout…</Text>
        <Text style={styles.sub}>Routing to the best provider for this corridor and posting to your ledger.</Text>
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
