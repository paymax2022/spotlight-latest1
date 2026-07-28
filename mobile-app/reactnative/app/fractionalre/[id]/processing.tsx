import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import PrimaryButton from '@/components/PrimaryButton';
import { useSubscribe } from '@/features/fractionalre/hooks';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';

export default function ProcessingScreen() {
  const { id, pin } = useLocalSearchParams<{ id: string; pin: string }>();
  const subscribe = useSubscribe();
  const { draft, patch } = useInvestDraft();
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !id) return;
    fired.current = true;
    (async () => {
      try {
        const res = await subscribe.mutateAsync({
          offeringId: id,
          req: {
            units: draft.mode === 'units' ? draft.units : undefined,
            amountKobo: draft.mode === 'amount' ? draft.amountKobo : undefined,
            pin: String(pin ?? ''),
            idempotencyKey: draft.idempotencyKey ?? `fre-${Date.now()}`,
            offerRiskAckId: draft.offerRiskAckId ?? '',
          },
        });
        patch({ investmentId: res.investmentId });
        router.replace({ pathname: `/fractionalre/${id}/certificate`, params: { investmentId: res.investmentId } } as never);
      } catch {
        setError('We could not complete your investment. No funds were taken. Please try again.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {error ? (
          <>
            <XCircle size={48} color={Colors.error} strokeWidth={2} />
            <Text style={styles.title}>Investment failed</Text>
            <Text style={styles.sub}>{error}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.title}>Processing your investment…</Text>
            <Text style={styles.sub}>Posting your subscription securely. Please don't close the app.</Text>
          </>
        )}
      </View>
      {error ? (
        <View style={styles.footer}>
          <PrimaryButton label="Try again" onPress={() => router.replace(`/fractionalre/${id}/invest` as never)} />
          <PrimaryButton label="Back to opportunity" variant="secondary" onPress={() => router.replace(`/fractionalre/${id}` as never)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
