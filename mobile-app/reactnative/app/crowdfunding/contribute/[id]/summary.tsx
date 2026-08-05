import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useCampaign, useInitiateContribution } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { PAYMENT_METHODS } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { computeFees, formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { PaymentMethod, ContributionDraft, InitiateContributionResult } from '@/features/crowdfunding/types/crowdfunding.types';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function ContributeSummaryScreen() {
  const params = useLocalSearchParams<{ id: string; amountKobo: string; anonymous?: string; message?: string; rewardTierId?: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(params.id);
  const initiate = useInitiateContribution();
  const checkout = usePurchasePayment<InitiateContributionResult>();

  const amountKobo = Number(params.amountKobo ?? 0);
  const [method, setMethod] = useState<PaymentMethod>('WALLET');
  const [accepted, setAccepted] = useState(false);

  const fees = computeFees(amountKobo, method);
  const tier = c?.rewardTiers.find((t) => t.id === params.rewardTierId) ?? null;

  const pay = () => {
    const draft: ContributionDraft = {
      campaignId: params.id,
      amountKobo,
      anonymous: params.anonymous === '1',
      message: params.message ?? null,
      rewardTierId: params.rewardTierId ?? null,
      shipping: null,
      paymentMethod: method,
      acceptedRefundPolicy: accepted,
    };
    checkout.start({
      amountKobo: fees.totalKobo,
      title: 'Contribute to campaign',
      // Honor the method already chosen on THIS screen so the shared sheet skips
      // its wallet/card chooser (the redundant second modal): WALLET charges the
      // wallet directly, and the card rails go straight to Paystack. CARD /
      // BANK_TRANSFER / USSD all settle via the Paystack gateway → 'card'.
      method: method === 'WALLET' ? 'wallet' : 'card',
      domain: 'crowdfunding',
      charge: () => initiate.mutateAsync({ draft, idempotencyKey: generateIdempotencyKey() }),
      onPaid: (res) => {
        router.replace(`/crowdfunding/contribute/${params.id}/processing?reference=${res.reference}&status=${res.status}`);
      },
    });
  };

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Review" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !c) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Review" /><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & pay" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Campaign summary */}
        <View style={styles.campaignRow}>
          <Text style={styles.campaignTitle} numberOfLines={2}>{c.title}</Text>
          {tier ? <Text style={styles.tierLine}>Reward: {tier.title}</Text> : null}
        </View>

        {/* Payment method */}
        <Text style={styles.sectionTitle}>Payment method</Text>
        {PAYMENT_METHODS.map((pm) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[pm.icon] ?? Icons.CreditCard;
          const active = method === pm.value;
          return (
            <Pressable
              key={pm.value}
              style={[styles.method, active && styles.methodActive]}
              onPress={() => setMethod(pm.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
            >
              <View style={[styles.methodIcon, active && styles.methodIconActive]}>
                <Icon size={18} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2.2} />
              </View>
              <View style={styles.methodBody}>
                <Text style={styles.methodLabel}>{pm.label}</Text>
                <Text style={styles.methodSub}>{pm.description}</Text>
              </View>
              {active && <Check size={18} color={Colors.primary} strokeWidth={2.6} />}
            </Pressable>
          );
        })}

        {/* Fee breakdown */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.feeCard}>
          <FeeRow label="Your contribution" value={formatNaira(fees.contributionKobo)} />
          <FeeRow label="Platform fee (2.5%)" value={formatNaira(fees.platformFeeKobo)} />
          <FeeRow label={method === 'WALLET' ? 'Payment fee' : 'Payment processing'} value={fees.paymentFeeKobo === 0 ? 'Free' : formatNaira(fees.paymentFeeKobo)} />
          <View style={styles.feeDivider} />
          <FeeRow label="Total to pay" value={formatNaira(fees.totalKobo)} bold />
          <View style={styles.infoRow}>
            <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.infoText}>The campaign receives the full {formatNaira(fees.contributionKobo)}. Fees are added on top.</Text>
          </View>
        </View>

        {/* Refund acceptance */}
        <Pressable style={styles.acceptRow} onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
          </View>
          <Text style={styles.acceptText}>
            I have read and accept the <Text style={styles.acceptLink} onPress={() => router.push(`/crowdfunding/campaign/${c.id}`)}>refund policy</Text> for this campaign.
          </Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay ${formatNaira(fees.totalKobo)}`}
          onPress={pay}
          loading={initiate.isPending}
          disabled={!accepted}
        />
      </View>
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

function FeeRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.feeRow}>
      <Text style={[styles.feeLabel, bold && styles.feeLabelBold]}>{label}</Text>
      <Text style={[styles.feeValue, bold && styles.feeValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  campaignRow: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  campaignTitle: { ...Typography.labelLg, color: Colors.onSurface },
  tierLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionTitle: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.sm },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  methodActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  methodIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  methodIconActive: { backgroundColor: Colors.primary },
  methodBody: { flex: 1 },
  methodLabel: { ...Typography.labelLg, color: Colors.onSurface },
  methodSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  feeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  feeLabelBold: { ...Typography.labelLg, color: Colors.onSurface },
  feeValue: { ...Typography.bodyMd, color: Colors.onSurface },
  feeValueBold: { ...Typography.titleMd, color: Colors.primary },
  feeDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  infoRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 2 },
  infoText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  acceptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.lg },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  acceptText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  acceptLink: { color: Colors.secondary, fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
