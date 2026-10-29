import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, ShieldAlert } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { NIGERIAN_STATES } from '@/constants/nigerianStates';
import { kycGrant } from '@/features/kycverify/draft';
import { rememberResume } from '@/lib/resume';
import type { DisbursementModel } from '@/features/crowdfunding/types/crowdfunding.types';
import { getKycProfile } from '@/api/kyc.api';
import { checkCampaignAmountAllowed, tierLimitMessage } from '@/features/crowdfunding/utils/tierLimits';

const DEADLINES = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
  { label: 'No deadline', days: 0 },
];

const MODELS: { value: DisbursementModel; label: string; desc: string }[] = [
  { value: 'ALL_OR_NOTHING', label: 'All-or-nothing', desc: 'Funds released only if you hit the goal; otherwise contributors are refunded.' },
  { value: 'FLEXIBLE', label: 'Flexible funding', desc: 'Keep whatever you raise, even below goal.' },
  { value: 'MILESTONE', label: 'Milestone-based', desc: 'Funds released in stages as you submit evidence.' },
];

export default function CreateFundingScreen() {
  const { draft, patch } = useCampaignDraft();
  const goalText = draft.goalKobo > 0 ? Math.round(draft.goalKobo / 100).toLocaleString('en-NG') : '';
  const kyc = useQuery({ queryKey: ['kyc', 'profile'], queryFn: getKycProfile, staleTime: 60_000, refetchOnMount: 'always' });

  const onGoal = (t: string) => {
    // Whole naira only; the thousands separators are display-only.
    const digits = t.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, 9);
    patch({ goalKobo: digits ? Number(digits) * 100 : 0 });
  };
  const setDeadline = (days: number) => {
    patch({ deadline: days === 0 ? null : new Date(Date.now() + days * 86_400_000).toISOString() });
  };
  const selectedDays = draft.deadline ? Math.round((+new Date(draft.deadline) - Date.now()) / 86_400_000) : 0;

  const valid = draft.goalKobo >= 100_000 && draft.location.trim().length > 1 && draft.disbursementModel != null;

  // KYC gate. Fails closed: until the creator's tier is known (loading / failed
  // to load) a goal cannot be confirmed as allowed, so Continue stays disabled.
  const hasGoal = draft.goalKobo > 0;
  // Same effective tier the KYC step-up gate uses: a just-completed upgrade counts
  // even before the profile endpoint reflects it (avoids a gate loop).
  const effectiveTier = Math.max(kyc.data?.tier ?? 0, kycGrant.tier);
  const tierCheck = kyc.data ? checkCampaignAmountAllowed(effectiveTier, draft.goalKobo) : null;
  const overTierLimit = hasGoal && !!tierCheck && !tierCheck.allowed;
  const tierUnknown = hasGoal && !kyc.data;
  const kycBlocked = overTierLimit || tierUnknown;
  const requiredTier = Math.min(3, tierCheck?.requiredTier ?? effectiveTier + 1);
  const tierMessage = overTierLimit ? tierLimitMessage(effectiveTier, draft.goalKobo) : '';

  const upgradeKyc = () => {
    // The KYC success screen calls resumeOrFallback(), which brings the creator
    // straight back here; the draft is persisted, so nothing is lost.
    rememberResume({ pathname: '/crowdfunding/create/funding' });
    router.push(`/kyc?target=${requiredTier}` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={6} totalSteps={9} title="Goal & funding" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Goal amount</Text>
          <View style={styles.amountWrap}>
            <Text style={styles.naira}>₦</Text>
            <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="number-pad" inputMode="numeric" maxLength={15} value={goalText} onChangeText={onGoal} />
            <View style={styles.currency}><Text style={styles.currencyText}>NGN</Text></View>
          </View>
          {draft.goalKobo > 0 && draft.goalKobo < 100_000 && <Text style={styles.err}>Minimum goal is ₦1,000.</Text>}
          {overTierLimit && (
            <View style={styles.gate} accessibilityRole="alert">
              <ShieldAlert size={20} color={Colors.error} strokeWidth={2} />
              <View style={styles.gateBody}>
                <Text style={styles.gateTitle}>KYC upgrade required</Text>
                <Text style={styles.gateText}>{tierMessage}</Text>
                <Text style={styles.gateText}>Verify to Tier {requiredTier} to raise {formatNaira(draft.goalKobo)}, or lower your goal.</Text>
                <Pressable onPress={upgradeKyc} style={styles.gateLink} accessibilityRole="link" accessibilityLabel="Upgrade KYC">
                  <Text style={styles.gateLinkText}>Upgrade KYC to Tier {requiredTier}</Text>
                </Pressable>
              </View>
            </View>
          )}
          {tierUnknown && kyc.isError && (
            <View style={styles.gate} accessibilityRole="alert">
              <ShieldAlert size={20} color={Colors.error} strokeWidth={2} />
              <View style={styles.gateBody}>
                <Text style={styles.gateText}>We couldn't check your KYC level, so we can't confirm this goal is allowed.</Text>
                <Pressable onPress={() => kyc.refetch()} style={styles.gateLink} accessibilityRole="button">
                  <Text style={styles.gateLinkText}>Retry</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Campaign duration</Text>
          <View style={styles.chipRow}>
            {DEADLINES.map((d) => {
              const active = (d.days === 0 && !draft.deadline) || (d.days !== 0 && Math.abs(selectedDays - d.days) <= 1);
              return (
                <Pressable key={d.label} style={[styles.chip, active && styles.chipActive]} onPress={() => setDeadline(d.days)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: Spacing.lg }} />
          <SelectField label="Location" placeholder="Select a state" value={draft.location} options={NIGERIAN_STATES} onChange={(v) => patch({ location: v })} />

          <Text style={styles.label}>Disbursement model</Text>
          <Text style={styles.hint}>Choose how and when raised funds are released to you.</Text>
          {MODELS.map((m) => {
            const active = draft.disbursementModel === m.value;
            return (
              <Pressable key={m.value} style={[styles.model, active && styles.modelActive]} onPress={() => patch({ disbursementModel: m.value })} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={styles.modelBody}>
                  <Text style={styles.modelLabel}>{m.label}</Text>
                  <Text style={styles.modelDesc}>{m.desc}</Text>
                </View>
                {active && <Check size={18} color={Colors.primary} strokeWidth={2.6} />}
              </Pressable>
            );
          })}

          {draft.goalKobo >= 100_000 && (
            <Text style={styles.preview}>Goal: {formatNaira(draft.goalKobo)}</Text>
          )}
        </ScrollView>
        <View style={styles.footer}>
          {overTierLimit ? (
            <PrimaryButton label={`Upgrade KYC to Tier ${requiredTier}`} onPress={upgradeKyc} />
          ) : (
            <PrimaryButton
              label="Continue"
              onPress={() => router.push('/crowdfunding/create/beneficiary')}
              disabled={!valid || kycBlocked}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: -4, marginBottom: Spacing.sm },
  amountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, height: 64 },
  naira: { ...Typography.headlineMd, color: Colors.onSurfaceVariant, marginRight: 4 },
  amountInput: { flex: 1, ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  currency: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  currencyText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: 6 },
  gate: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, borderWidth: 1, borderColor: Colors.error },
  gateBody: { flex: 1, gap: 4 },
  gateTitle: { ...Typography.labelLg, color: Colors.error },
  gateText: { ...Typography.bodySm, color: Colors.onSurface },
  gateLink: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.primary },
  gateLinkText: { ...Typography.labelMd, color: Colors.onPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  model: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  modelActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  modelBody: { flex: 1 },
  modelLabel: { ...Typography.labelLg, color: Colors.onSurface },
  modelDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  preview: { ...Typography.labelMd, color: Colors.primary, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
