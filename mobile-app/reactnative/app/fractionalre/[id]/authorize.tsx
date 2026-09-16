import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';
import { useSubscribe } from '@/features/fractionalre/hooks';
import { formatNaira } from '@/features/fractionalre/utils';
import type { SubscribeResult } from '@/features/fractionalre/types';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

/**
 * PIN/biometric authorization step (§8.D.6). The PIN is held only in local
 * component state and handed to the processing screen via the draft store; the
 * money mutation (subscribe) carries the PIN + Idempotency-Key in the API layer.
 */
export default function AuthorizeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { draft, patch } = useInvestDraft();
  const subscribe = useSubscribe();
  const checkout = usePurchasePayment<SubscribeResult>();
  const [pin, setPin] = useState('');

  const platformFee = Math.round((draft.amountKobo * 0) / 10_000); // display only; server authoritative
  const totalKobo = draft.amountKobo + platformFee;
  const valid = /^\d{4,6}$/.test(pin);

  const onAuthorize = () => {
    checkout.start({
      amountKobo: totalKobo,
      title: 'Confirm investment',
      charge: () => subscribe.mutateAsync({
        offeringId: String(id),
        req: {
          units: draft.mode === 'units' ? draft.units : undefined,
          amountKobo: draft.mode === 'amount' ? draft.amountKobo : undefined,
          pin,
          idempotencyKey: draft.idempotencyKey ?? `fre-${Date.now()}`,
          offerRiskAckId: draft.offerRiskAckId ?? '',
        },
      }),
      onPaid: (res) => {
        patch({ investmentId: res.investmentId });
        router.replace({ pathname: `/fractionalre/${id}/certificate`, params: { investmentId: res.investmentId } } as never);
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Authorize" subtitle="Confirm with your transaction PIN" />
      <View style={styles.body}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>You are investing</Text>
          <Text style={styles.amount}>{formatNaira(totalKobo)}</Text>
          <Text style={styles.amountSub}>{draft.units} unit{draft.units === 1 ? '' : 's'} · fees confirmed at execution</Text>
        </View>

        <View style={styles.pinBlock}>
          <View style={styles.pinHeader}>
            <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.pinLabel}>Enter your PIN to confirm</Text>
          </View>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            style={styles.pinInput}
            placeholder="••••"
            placeholderTextColor={Colors.onSurfaceVariant}
          />
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="Authorize investment"
          onPress={onAuthorize}
          disabled={!valid || subscribe.isPending}
          loading={subscribe.isPending}
        />
      </SafeAreaView>
      {/* checkout.start() only flips this sheet's state — without it mounted the
          button appears to do nothing at all. */}
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, padding: Spacing.containerMargin, gap: Spacing.lg },
  amountCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineLg, color: Colors.onSurface },
  amountSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pinBlock: { gap: Spacing.sm },
  pinHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  pinInput: {
    ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', letterSpacing: 8,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
