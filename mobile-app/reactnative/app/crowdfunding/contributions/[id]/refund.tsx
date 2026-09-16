import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useContribution, useRequestRefund } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

const REASONS = [
  'Campaign turned out to be misleading',
  'I contributed by mistake',
  'Duplicate contribution',
  'Concerns about how funds are used',
  'Other',
];

export default function RefundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading } = useContribution(id);
  const refund = useRequestRefund();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Request refund" /><StateView kind="loading" /></SafeAreaView>;

  if (c && !c.refundEligible) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request refund" />
        <StateView kind="empty" icon="ShieldOff" title="Not eligible for refund" message="This contribution isn't eligible under the campaign's refund policy, or funds have already been disbursed." actionLabel="Go back" onAction={() => goBack('/crowdfunding/contributions')} />
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Refund requested" showBack={false} />
        <StateView kind="empty" icon="CircleCheck" title="Refund request submitted" message="We've received your request. Our team will review it and notify you of the outcome, usually within 7 business days." actionLabel="Done" onAction={() => router.dismissTo('/crowdfunding/contributions')} />
      </SafeAreaView>
    );
  }

  const submit = () => {
    refund.mutate({ id: id as string, reason: `${reason}${details ? ` — ${details}` : ''}` }, { onSuccess: () => setDone(true) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request refund" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {c && (
            <View style={styles.amountCard}>
              <Text style={styles.amountLabel}>Refund amount</Text>
              <Text style={styles.amount}>{formatNaira(c.amountKobo)}</Text>
              <Text style={styles.amountSub}>{c.campaignTitle}</Text>
            </View>
          )}

          <View style={styles.banner}>
            <Info size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.bannerText}>Refunds follow this campaign's policy and are reviewed before approval. Platform/payment fees may not be refundable.</Text>
          </View>

          <Text style={styles.label}>Reason for refund</Text>
          {REASONS.map((r) => {
            const active = reason === r;
            return (
              <Pressable key={r} style={[styles.option, active && styles.optionActive]} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{r}</Text>
                {active && <Check size={18} color={Colors.secondary} strokeWidth={2.4} />}
              </Pressable>
            );
          })}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Additional details (optional)</Text>
          <TextInput style={styles.input} placeholder="Tell us more…" placeholderTextColor={Colors.outline} value={details} onChangeText={setDetails} multiline textAlignVertical="top" />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit refund request" onPress={submit} disabled={!reason} loading={refund.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  amountCard: { alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg, marginBottom: Spacing.sm },
  amountLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  amountSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: 4 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  optionActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionTextActive: { fontWeight: '600' as const },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 100, ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
