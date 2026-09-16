import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, Linking,
} from 'react-native';
import { alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Wallet, CreditCard, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useDraft, useInitiateRegistrationPayment } from '@/features/registration/hooks/useRegistration';
import { newRegistrationIdempotencyKey } from '@/features/registration/api/registration.client';
import { useAuthStore } from '@/store/authStore';
import type { RegistrationPaymentMethod } from '@/features/registration/types/registration.types';

// WALLET is disabled: registration fees don't yet have a real wallet-debit
// path (that needs an escrow hold + ledger release, same iron rules as every
// other money mutation) — showing it as pickable would either fake success or
// surface a confusing error. PAYSTACK goes through the real gateway
// (test mode) via app/api/registration/applications/[id]/payment/*.
const METHODS: { id: RegistrationPaymentMethod; label: string; desc: string; Icon: typeof Wallet; disabled?: boolean }[] = [
  { id: 'WALLET',   label: 'Spotlight Wallet', desc: 'Coming soon',   Icon: Wallet, disabled: true },
  { id: 'PAYSTACK', label: 'Card / Bank / USSD', desc: 'Pay securely via Paystack hosted checkout',  Icon: CreditCard },
];

function fmt(ngn: number) {
  return `₦${ngn.toLocaleString('en-NG')}`;
}

export default function RegistrationPaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';

  const draftQuery = useDraft(appId);
  const initiate   = useInitiateRegistrationPayment(appId);
  const user       = useAuthStore((s) => s.user);

  const [selected, setSelected] = useState<RegistrationPaymentMethod>('PAYSTACK');
  // One key per screen visit (not per tap) — a double-tap or a network-level
  // retry of the same "Pay" attempt reuses it, so the initiate route can't be
  // tricked into opening two Paystack transactions for one fee.
  const idempotencyKeyRef = React.useRef(newRegistrationIdempotencyKey());

  const draft = draftQuery.data?.draft;
  const feeNgn = Number(draft?.formData['payment.feeAmount'] ?? 0);
  const feeKobo = feeNgn * 100;

  if (draftQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration Payment" />
        <StateView kind="loading" message="Loading payment details…" />
      </SafeAreaView>
    );
  }

  if (draftQuery.isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration Payment" />
        <StateView kind="error" title="Couldn't load application" actionLabel="Retry" onAction={() => draftQuery.refetch()} />
      </SafeAreaView>
    );
  }

  const handlePay = async () => {
    try {
      const result = await initiate.mutateAsync({
        amountKobo: feeKobo,
        method: selected,
        email: user?.email ?? '',
        name:  user?.fullName ?? '',
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (selected === 'WALLET') {
        // Wallet: instant settlement — go straight to submit review.
        router.replace(`/registration/${appId}/submit` as never);
        return;
      }

      // Paystack: open hosted checkout, then navigate to processing/verification.
      const params = `transactionId=${encodeURIComponent(result.transactionId)}&reference=${encodeURIComponent(result.reference)}`;
      if (result.authorizationUrl) {
        await Linking.openURL(result.authorizationUrl);
      }
      router.push(`/registration/${appId}/payment-processing?${params}` as never);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? 'Could not start payment. Please try again.';
      alertAsync({ title: 'Payment failed', message: msg });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/registration')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Registration Payment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Fee summary */}
        <View style={[styles.summaryCard, shadow1]}>
          <Text style={styles.summaryLabel}>Registration fee</Text>
          <Text style={styles.summaryAmount}>{fmt(feeNgn)}</Text>
          <Text style={styles.summaryRef}>Ref: {draft.reference}</Text>
        </View>

        <Text style={styles.sectionLabel}>Select Payment Method</Text>

        <View style={styles.methodsList}>
          {METHODS.map(({ id: mId, label, desc, Icon, disabled }) => {
            const active = selected === mId;
            return (
              <Pressable
                key={mId}
                onPress={() => !disabled && setSelected(mId)}
                disabled={disabled}
                style={[styles.methodCard, active && styles.methodCardActive, disabled && styles.methodCardDisabled, shadow1]}
              >
                <View style={[styles.methodIcon, { backgroundColor: active ? Colors.iconBgPurple : Colors.surfaceContainerHigh }]}>
                  <Icon size={20} color={disabled ? Colors.outline : active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={1.8} />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={[styles.methodLabel, active && { color: Colors.primary }, disabled && { color: Colors.outline }]}>{label}</Text>
                  <Text style={styles.methodDesc}>{desc}</Text>
                </View>
                {!disabled && (
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.secureRow}>
          <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.secureText}>Your payment is secured and processed by Paystack</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay ${fmt(feeNgn)}`}
          onPress={handlePay}
          loading={initiate.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:   { ...Typography.titleLg, color: Colors.onSurface },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 120 },

  summaryCard:   { backgroundColor: Colors.primaryContainer, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  summaryLabel:  { ...Typography.labelMd, color: Colors.onPrimaryContainer, opacity: 0.8 },
  summaryAmount: { ...Typography.headlineLg, color: Colors.onPrimaryContainer, fontWeight: '700' as const },
  summaryRef:    { ...Typography.labelSm, color: Colors.onPrimaryContainer, opacity: 0.6, marginTop: 2 },

  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  methodsList:  { gap: Spacing.sm },
  methodCard:   {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh,
  },
  methodCardActive: { borderColor: Colors.primary },
  methodCardDisabled: { opacity: 0.5 },
  methodIcon:  { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  methodInfo:  { flex: 1, gap: 2 },
  methodLabel: { ...Typography.labelMd, color: Colors.onSurface },
  methodDesc:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  radio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: Colors.primary },
  radioDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },

  secureRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  secureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
  },
});
