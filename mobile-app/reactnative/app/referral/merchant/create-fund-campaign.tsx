import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useMerchantDashboard, useCreateAndFundCampaign } from '@/features/referral/merchant/hooks';
import type { CreateCampaignInput, FundCampaignResult } from '@/features/referral/merchant/types';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

// M-MER-02 — Create / fund campaign (lite): quick campaign + wallet funding.
// Funding debits the merchant wallet in kobo; the live mutation carries an
// Idempotency-Key (see merchant/api.ts).
const ACTIONS: { key: CreateCampaignInput['qualifyingAction']; label: string }[] = [
  { key: 'first_transaction', label: 'First transaction' },
  { key: 'kyc_completed', label: 'KYC completed' },
  { key: 'purchase', label: 'Purchase' },
];

// Parse a naira string into integer kobo. Never use floats for money math.
function nairaToKobo(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const [whole, frac = ''] = cleaned.split('.');
  const naira = parseInt(whole || '0', 10);
  const kobo = parseInt((frac + '00').slice(0, 2), 10);
  if (Number.isNaN(naira) || Number.isNaN(kobo)) return 0;
  return naira * 100 + kobo;
}

export default function CreateFundCampaignScreen() {
  const dash = useMerchantDashboard();
  const create = useCreateAndFundCampaign();
  const checkout = usePurchasePayment<FundCampaignResult>();
  const [name, setName] = useState('');
  const [reward, setReward] = useState('');
  const [budget, setBudget] = useState('');
  const [action, setAction] = useState<CreateCampaignInput['qualifyingAction']>('first_transaction');
  const [done, setDone] = useState<{ ref: string; balance: number } | null>(null);

  const rewardKobo = nairaToKobo(reward);
  const budgetKobo = nairaToKobo(budget);
  const walletKobo = dash.data?.walletBalanceKobo ?? 0;
  const overBudget = budgetKobo > walletKobo;
  const canSubmit = !!name.trim() && rewardKobo > 0 && budgetKobo > 0 && !overBudget;

  const submit = () => {
    checkout.start({
      amountKobo: budgetKobo,
      title: 'Fund campaign',
      charge: () => create.mutateAsync({ name: name.trim(), rewardPerConversionKobo: rewardKobo, budgetKobo, qualifyingAction: action }),
      onPaid: (res) => {
        if (res.ok) setDone({ ref: res.reference, balance: res.newWalletBalanceKobo });
        else {
          const msg = res.error === 'insufficient_funds' ? 'Not enough wallet balance to fund this budget.' : res.error === 'invalid_amount' ? 'Enter a valid reward and budget.' : 'Funding failed.';
          Alert.alert('Could not fund campaign', msg);
        }
      },
    });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Campaign funded" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.successHero}>
            <View style={styles.successIcon}><Check size={32} color={Colors.tertiaryContainer} strokeWidth={2.4} /></View>
            <Text style={styles.successTitle}>Campaign created & funded</Text>
            <Text style={styles.successSub}>Reference {done.ref}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Row label="Funded from wallet" value={formatNaira(budgetKobo)} />
            <Row label="Reward per conversion" value={formatNaira(rewardKobo)} />
            <Row label="New wallet balance" value={formatNaira(done.balance)} last />
          </View>
          <DisclosureCard tone="compliant" title="Rewards are activity-based" body="Your funded rewards pay out only on verified conversions — real customer activity, not signups alone." />
          <PrimaryButton label="Back to dashboard" onPress={() => router.replace('/referral/merchant/dashboard')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create & fund campaign" />
      {dash.isLoading ? (
        <StateView kind="loading" message="Loading wallet…" />
      ) : dash.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={dash.refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.walletStrip}>
            <Text style={styles.walletStripLabel}>Wallet balance</Text>
            <Text style={styles.walletStripValue}>{formatNaira(walletKobo)}</Text>
          </View>

          <TextInputField label="Campaign name" value={name} onChangeText={setName} placeholder="e.g. New-customer cashback" />
          <TextInputField label="Reward per conversion (₦)" value={reward} onChangeText={setReward} placeholder="2000" keyboardType="numeric" />
          <TextInputField label="Total budget to fund (₦)" value={budget} onChangeText={setBudget} placeholder="200000" keyboardType="numeric" error={overBudget ? 'Exceeds wallet balance' : undefined} />

          <Text style={styles.label}>Qualifying action</Text>
          <View style={styles.actions}>
            {ACTIONS.map((a) => (
              <Pressable key={a.key} style={[styles.action, action === a.key && styles.actionActive]} onPress={() => setAction(a.key)} accessibilityRole="button">
                <Text style={[styles.actionText, action === a.key && styles.actionTextActive]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>

          {budgetKobo > 0 && rewardKobo > 0 ? (
            <View style={styles.estimate}>
              <Text style={styles.estimateText}>≈ {Math.floor(budgetKobo / rewardKobo)} conversions at this reward</Text>
            </View>
          ) : null}

          <DisclosureCard tone="info" title="Funded from your wallet" body="The budget is debited from your wallet now. Rewards pay out to referrers only on verified conversions." />

          <PrimaryButton label={`Fund ${budgetKobo > 0 ? formatNaira(budgetKobo) : 'campaign'}`} onPress={submit} loading={create.isPending} disabled={!canSubmit} />
        </ScrollView>
      )}
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.md },
  walletStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  walletStripLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  walletStripValue: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '800' as const },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  actions: { flexDirection: 'row', gap: Spacing.xs },
  action: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center' },
  actionActive: { backgroundColor: Colors.primary },
  actionText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  actionTextActive: { color: Colors.onPrimary },
  estimate: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.sm },
  estimateText: { ...Typography.labelMd, color: Colors.tertiaryContainer, textAlign: 'center' },
  successHero: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  successIcon: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface },
  successSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryBox: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
});
