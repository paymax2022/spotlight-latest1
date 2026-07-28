import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Banknote, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import { formatKobo } from '@/features/connect/constants/format';
import { usePayoutEligibility } from '@/features/connect/wallet/hooks';

// WL-19 — Creator payout intro. Gift revenue withdrawal is Tier 2+ & KYC gated.
export default function PayoutIntro() {
  const elig = usePayoutEligibility();

  if (elig.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Payouts" />
        <StateView kind="loading" message="Checking eligibility…" />
      </SafeAreaView>
    );
  }
  if (elig.error || !elig.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Payouts" />
        <StateView kind="error" title="Couldn't load payouts" actionLabel="Retry" onAction={() => elig.refetch()} />
      </SafeAreaView>
    );
  }

  const e = elig.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payouts" rightSlot={
        <Pressable onPress={() => router.push('/connect/wallet/payouts/history')} hitSlop={8}>
          <Text style={styles.tab}>History</Text>
        </Pressable>
      } />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available to withdraw</Text>
          <MoneyAmount kobo={e.availableKobo} size="xl" style={styles.balanceValue} />
          {e.pendingKobo > 0 ? <Text style={styles.pending}>{formatKobo(e.pendingKobo)} pending settlement</Text> : null}
        </View>

        <TierLimitBar tier={e.tier} />

        {e.eligible ? (
          <>
            <View style={styles.methodRow}>
              <View style={styles.methodIcon}><Banknote size={18} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodLabel}>Payout account</Text>
                <Text style={styles.methodValue}>{e.payoutMethodMasked ?? 'Not set'}</Text>
              </View>
            </View>
            <Text style={styles.note}>Minimum payout {formatKobo(e.minPayoutKobo)}. Payouts settle to your linked bank account.</Text>
          </>
        ) : (
          <View style={styles.gated}>
            <Lock size={18} color={Colors.gold} />
            <Text style={styles.gatedText}>{e.reason ?? 'Reach Tier 2 to withdraw gift revenue.'}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {e.eligible ? (
          <PrimaryButton label="Request payout" onPress={() => router.push('/connect/wallet/payouts/request')} />
        ) : (
          <PrimaryButton label="Upgrade tier to withdraw" onPress={() => router.push('/connect/wallet/tier/upgrade-intro')} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tab: { ...Typography.labelMd, color: Colors.primary },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  balanceCard: { backgroundColor: Colors.primaryContainer, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.sm },
  balanceLabel: { ...Typography.labelMd, color: Colors.onPrimaryContainer },
  balanceValue: { color: Colors.onPrimaryContainer, marginTop: Spacing.xs },
  pending: { ...Typography.labelSm, color: Colors.onPrimaryContainer, opacity: 0.8, marginTop: Spacing.xs },
  methodRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg, padding: Spacing.md,
  },
  methodIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  methodValue: { ...Typography.labelLg, color: Colors.onSurface },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  gated: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  gatedText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
