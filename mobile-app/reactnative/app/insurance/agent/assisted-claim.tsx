import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, CircleCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCustomer, useAgentBook } from '@/features/insurance/agent';
import { useSubmitFnol } from '@/features/insurance/claims';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import type { AgentBookEntry } from '@/features/insurance/agent';

/** Agent: assisted claim FNOL on behalf of a customer (PRD §15.2). */
export default function AssistedClaim() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const customer = useCustomer(customerId ?? '');
  const book = useAgentBook();
  const submit = useSubmitFnol();
  const idemKey = useRef(`ins-aclaim-${customerId}-${Math.random().toString(36).slice(2, 10)}`).current;

  const [selected, setSelected] = useState<AgentBookEntry | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const customerPolicies = useMemo(
    () => (book.data ?? []).filter((b) => b.customerId === customerId && b.state === 'ACTIVE'),
    [book.data, customerId],
  );

  if (customer.isLoading || book.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Assisted claim" />
        <StateView kind="loading" message="Loading customer cover…" />
      </SafeAreaView>
    );
  }
  if (customer.isError || !customer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Assisted claim" />
        <StateView kind="error" title="Customer not found" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const onSubmit = async () => {
    setError(null);
    if (!selected) { setError('Select a policy to claim against.'); return; }
    if (!amount || Number.isNaN(Number(amount))) { setError('Enter the amount claimed.'); return; }
    if (!description.trim()) { setError('Describe what happened.'); return; }
    await submit.mutateAsync({
      policyId: selected.policyId,
      perilCode: 'general.loss',
      inputs: { claimedAmount: amount, description, lossEventAt: new Date().toISOString() },
      idempotencyKey: idemKey,
    });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim filed" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.heroIcon}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>Claim reported</Text>
          <Text style={styles.successSub}>We've logged the first notice of loss for {customer.data.fullName}. They can track it in their app.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to book" onPress={() => router.replace('/insurance/agent/book')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Assisted claim" subtitle={customer.data.fullName} />

      {customerPolicies.length === 0 ? (
        <StateView kind="empty" title="No active cover" message="This customer has no active policy to claim against." icon="ShieldCheck" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Policy</Text>
            {customerPolicies.map((b) => {
              const active = selected?.policyId === b.policyId;
              return (
                <Pressable
                  key={b.policyId}
                  onPress={() => setSelected(b)}
                  accessibilityRole="button"
                  style={[styles.policyCard, active && styles.policyCardActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.policyTitle}>{b.productName}</Text>
                    <Text style={styles.policyMeta}>Cover {formatNaira(b.sumInsuredKobo)}</Text>
                  </View>
                  {active ? <CircleCheck size={20} color={InsuranceColors.ok} /> : <ChevronRight size={20} color={Colors.onSurfaceVariant} />}
                </Pressable>
              );
            })}

            {selected ? <UnderwriterBadge disclosure={{ underwriter: selected.provider === 'OCTAMILE' ? 'AXA Mansard' : 'Hygeia HMO', aggregator: selected.provider === 'OCTAMILE' ? 'Octamile' : 'MyCover.ai' }} /> : null}

            <TextInputField label="Amount claimed (₦)" value={amount} onChangeText={setAmount} placeholder="0" keyboardType="numeric" />
            <TextInputField label="What happened?" value={description} onChangeText={setDescription} placeholder="Describe the incident" multiline numberOfLines={4} />

            {error ? <Text style={styles.err}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label="File claim (FNOL)" onPress={onSubmit} loading={submit.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.sm },
  section: { ...Typography.titleMd, color: Colors.onSurface },
  policyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md },
  policyCardActive: { borderColor: InsuranceColors.ok, backgroundColor: InsuranceColors.okBg },
  policyTitle: { ...Typography.labelLg, color: Colors.onSurface },
  policyMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  err: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  heroIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
