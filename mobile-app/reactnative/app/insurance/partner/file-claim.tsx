import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, ChevronRight } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { usePartnerPolicies, useFilePartnerClaim } from '@/features/insurance/partner';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import type { PartnerPolicy } from '@/features/insurance/partner';

/** Partner/driver: file embedded claim (PRD §15.3). Idempotency-Key on FNOL. */
export default function PartnerFileClaim() {
  const { policyId } = useLocalSearchParams<{ policyId?: string }>();
  const policies = usePartnerPolicies();
  const file = useFilePartnerClaim();
  const idemKey = useRef(`ins-pfnol-${policyId ?? 'x'}-${Math.random().toString(36).slice(2, 10)}`).current;

  const [selectedId, setSelectedId] = useState<string | undefined>(policyId);
  const [location, setLocation] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo<PartnerPolicy | undefined>(
    () => (policies.data ?? []).find((p) => p.id === selectedId),
    [policies.data, selectedId],
  );

  if (policies.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="File a claim" />
        <StateView kind="loading" message="Loading your cover…" />
      </SafeAreaView>
    );
  }
  if (policies.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="File a claim" />
        <StateView kind="error" title="Couldn't load cover" actionLabel="Retry" onAction={() => policies.refetch()} />
      </SafeAreaView>
    );
  }

  const claimable = (policies.data ?? []).filter((p) => p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE');

  if (claimable.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="File a claim" />
        <StateView kind="empty" title="No active cover" message="You need active cover to file a claim." icon="ShieldCheck" />
      </SafeAreaView>
    );
  }

  const onSubmit = async () => {
    setError(null);
    if (!selected) { setError('Select the cover affected.'); return; }
    if (!amount || Number.isNaN(Number(amount))) { setError('Enter the estimated amount.'); return; }
    if (!description.trim()) { setError('Describe the incident.'); return; }
    const claim = await file.mutateAsync({
      policyId: selected.id,
      inputs: { claimedAmount: amount, description, location, lossEventAt: new Date().toISOString() },
      idempotencyKey: idemKey,
    });
    router.replace(`/insurance/partner/inspection-upload?id=${claim.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="File a claim" subtitle="Report an incident" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Cover affected</Text>
        {claimable.map((p) => {
          const active = selectedId === p.id;
          return (
            <Pressable key={p.id} onPress={() => setSelectedId(p.id)} accessibilityRole="button" style={[styles.policyCard, active && styles.policyCardActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.policyTitle}>{p.productName}</Text>
                <Text style={styles.policyMeta}>Cover {formatNaira(p.sumInsuredKobo)}</Text>
              </View>
              {active ? <CircleCheck size={20} color={InsuranceColors.ok} /> : <ChevronRight size={20} color={Colors.onSurfaceVariant} />}
            </Pressable>
          );
        })}

        {selected ? <UnderwriterBadge disclosure={selected.disclosure} /> : null}

        <TextInputField label="Location" value={location} onChangeText={setLocation} placeholder="Where did it happen?" />
        <TextInputField label="Estimated damage (₦)" value={amount} onChangeText={setAmount} placeholder="0" keyboardType="numeric" />
        <TextInputField label="What happened?" value={description} onChangeText={setDescription} placeholder="Describe the incident" multiline numberOfLines={4} />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Text style={styles.note}>You'll add inspection photos next. Claims for mobility cover are fast-tracked with remote inspection.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit & add inspection" onPress={onSubmit} loading={file.isPending} />
      </View>
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
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20, marginTop: Spacing.xs },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
