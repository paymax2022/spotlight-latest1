import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { useReportAbuse } from '@/features/referral/foundation/hooks';
import type { AbuseReport } from '@/features/referral/foundation/api';

// M-ACC-02 — Report abuse / suspicious referral. Trust & safety reporting.
const CATEGORIES: { value: AbuseReport['category']; label: string }[] = [
  { value: 'fake_signup',   label: 'Fake or bot signups' },
  { value: 'paid_to_join',  label: 'Someone paid people to "join"' },
  { value: 'impersonation', label: 'Impersonation or stolen identity' },
  { value: 'other',         label: 'Something else' },
];

export default function ReportAbuse() {
  const report = useReportAbuse();
  const [category, setCategory] = useState<AbuseReport['category'] | null>(null);
  const [detail, setDetail] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);

  const onSubmit = () => {
    if (!category) return;
    report.mutate({ category, detail: detail.trim() }, { onSuccess: (r) => setTicketId(r.ticketId) });
  };

  if (ticketId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ReferralHeader title="Report submitted" showBack={false} />
        <StateView
          kind="empty"
          icon="ShieldCheck"
          title="Thank you for the report"
          message={`Our Trust & Safety team will review it. Reference: ${ticketId}.`}
          actionLabel="Done"
          onAction={() => router.replace('/referral/(tabs)/home')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Report abuse" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DisclosureCard
          tone="info"
          title="Help keep earning fair"
          body="Reports are confidential. Flagging suspicious referrals protects honest earners and the reward budget."
        />

        <Text style={styles.label}>What happened?</Text>
        <View style={styles.options}>
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <Pressable key={c.value} style={[styles.option, active && styles.optionActive]} onPress={() => setCategory(c.value)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.radio, active && styles.radioOn]}>{active && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}</View>
                <Text style={styles.optionLabel}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField
          label="Details (optional)"
          placeholder="Tell us what you saw…"
          value={detail}
          onChangeText={setDetail}
          multiline
          numberOfLines={4}
          style={styles.textarea}
        />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Submit report" onPress={onSubmit} disabled={!category} loading={report.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  options: { gap: Spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  radio: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
