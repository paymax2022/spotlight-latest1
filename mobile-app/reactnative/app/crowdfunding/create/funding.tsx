import React from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { sanitizeMoneyInput } from '@/utils/money';
import type { DisbursementModel } from '@/features/crowdfunding/types/crowdfunding.types';

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
  const goalText = draft.goalKobo > 0 ? String(Math.round(draft.goalKobo / 100)) : '';

  const onGoal = (t: string) => {
    const digits = t.replace(/[^0-9]/g, '');
    patch({ goalKobo: digits ? Number(digits) * 100 : 0 });
  };
  const setDeadline = (days: number) => {
    patch({ deadline: days === 0 ? null : new Date(Date.now() + days * 86_400_000).toISOString() });
  };
  const selectedDays = draft.deadline ? Math.round((+new Date(draft.deadline) - Date.now()) / 86_400_000) : 0;

  const valid = draft.goalKobo >= 100_000 && draft.location.trim().length > 1 && draft.disbursementModel != null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={6} totalSteps={9} title="Goal & funding" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Goal amount</Text>
          <View style={styles.amountWrap}>
            <Text style={styles.naira}>₦</Text>
            <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" maxLength={13} value={goalText} onChangeText={(t) => onGoal(sanitizeMoneyInput(t))} />
            <View style={styles.currency}><Text style={styles.currencyText}>NGN</Text></View>
          </View>
          {draft.goalKobo > 0 && draft.goalKobo < 100_000 && <Text style={styles.err}>Minimum goal is ₦1,000.</Text>}

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
          <TextInputField label="Location" placeholder="e.g. Enugu, Nigeria" value={draft.location} onChangeText={(t) => patch({ location: t })} />

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
          <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/beneficiary')} disabled={!valid} />
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
