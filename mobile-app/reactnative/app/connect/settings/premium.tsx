import React from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Crown, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import { usePremiumPlans, usePremiumStatus, useTierStatus, useSubscribePremium, useCancelPremium } from '@/features/connect/hooks/useConnect';
import { formatKobo } from '@/features/connect/constants/format';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import type { PremiumPlan } from '@/features/connect/types/connect.types';

// ST-13 — Premium/subscription. Plans, manage, restore.
// Premium is a wallet purchase → a money surface, so tier/limit/remaining is shown.
// The charge runs through the shared checkout (wallet or card, Idempotency-Key);
// subscribePremium activates the plan only after payment succeeds.
export default function Premium() {
  const { data: plans, isLoading, error, refetch } = usePremiumPlans();
  const { data: status, refetch: refetchStatus } = usePremiumStatus();
  const { data: tier } = useTierStatus();
  const subscribe = useSubscribePremium();
  const cancel = useCancelPremium();
  const checkout = usePurchasePayment();

  const buy = (plan: PremiumPlan) => checkout.start({
    amountKobo: plan.priceKobo,
    title: plan.name,
    domain: 'connect_premium',
    charge: () => subscribe.mutateAsync(plan.id),
    onPaid: () => { void alertAsync({ title: 'You’re on Connect Plus', message: 'Your premium perks are now active. Enjoy!' }); },
  });

  const manage = async () => {
    const ok = await confirmAsync({
      title: 'Manage subscription',
      message: 'Your Connect Plus subscription is active.',
      confirmLabel: 'Cancel subscription',
      cancelLabel: 'Keep subscription',
      destructive: true,
    });
    if (ok) cancel.mutate();
  };

  const restore = () => refetchStatus().then((r) => alertAsync({
    title: r.data?.active ? 'Subscription restored' : 'Nothing to restore',
    message: r.data?.active
      ? 'Your Connect Plus subscription is active.'
      : 'We could not find an active subscription for this account.',
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Premium" />
      {isLoading ? (
        <StateView kind="loading" message="Loading plans…" />
      ) : error || !plans ? (
        <StateView kind="error" title="Couldn't load plans" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Crown size={28} color={Colors.gold} strokeWidth={2} /></View>
            <Text style={styles.heroTitle}>Connect Plus</Text>
            <Text style={styles.heroBody}>Stand out, see who likes you, and get more matches.</Text>
            {status?.active ? <View style={styles.activePill}><Text style={styles.activePillText}>Active</Text></View> : null}
          </View>

          {tier ? <TierLimitBar tier={tier} /> : null}

          {plans.map((p) => (
            <View key={p.id} style={styles.planCard}>
              <View style={styles.planHead}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planPrice}>
                  {formatKobo(p.priceKobo)}
                  <Text style={styles.planCadence}>/{p.cadence === 'monthly' ? 'mo' : 'yr'}</Text>
                </Text>
              </View>
              {p.perks.map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Check size={14} color={Colors.teal} strokeWidth={2.5} />
                  <Text style={styles.perkText}>{perk}</Text>
                </View>
              ))}
              <View style={{ marginTop: Spacing.sm }}>
                <PrimaryButton
                  label={status?.active ? 'Manage' : `Subscribe · ${formatKobo(p.priceKobo)}`}
                  loading={subscribe.isPending && subscribe.variables === p.id}
                  onPress={() => (status?.active ? manage() : buy(p))}
                />
              </View>
            </View>
          ))}

          <Pressable onPress={restore} accessibilityRole="button">
            <Text style={styles.restore}>Restore purchases</Text>
          </Pressable>
        </ScrollView>
      )}
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md, paddingTop: Spacing.sm },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  activePill: { backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full, marginTop: Spacing.xs },
  activePillText: { ...Typography.labelSm, color: Colors.teal },
  planCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.xs },
  planHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: Spacing.xs },
  planName: { ...Typography.titleMd, color: Colors.onSurface },
  planPrice: { ...Typography.titleLg, color: Colors.primary },
  planCadence: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  perkText: { ...Typography.bodyMd, color: Colors.onSurface },
  restore: { ...Typography.labelMd, color: Colors.secondary, textAlign: 'center', marginTop: Spacing.sm },
});
