import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Paperclip, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { useAppealClawback } from '@/features/referral/earnings/hooks';
import type { AppealResult } from '@/features/referral/earnings/types';

// M-ERN-09 — Appeal a clawback: submit evidence for review.
const EVIDENCE_PRESETS = ['Chat showing real relationship', 'Screenshot of their activity', 'Proof of separate identity', 'Other supporting document'];

export default function AppealClawbackScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const clawbackId = params.id ?? '';
  const appeal = useAppealClawback();
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [result, setResult] = useState<AppealResult | null>(null);

  const toggleEvidence = (label: string) => {
    setEvidence((prev) => (prev.includes(label) ? prev.filter((e) => e !== label) : [...prev, label]));
  };

  if (!clawbackId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Appeal" />
        <StateView kind="error" title="Nothing to appeal" message="Open this from a clawback notice." actionLabel="Back" onAction={() => goBack('/referral/earnings')} />
      </SafeAreaView>
    );
  }

  if (result?.ok) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Appeal submitted" showBack={false} />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Appeal submitted"
          message={`Case ${result.caseId}. Our team will review your evidence and notify you of the outcome.`}
          actionLabel="Done"
          onAction={() => router.replace('/referral/(tabs)/earnings')}
        />
      </SafeAreaView>
    );
  }

  const canSubmit = reason.trim().length >= 10;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Appeal a clawback" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <DisclosureCard
          tone="info"
          title="Tell us what happened"
          body="Explain why you believe this referral was genuine. Honest, specific detail and evidence help our team review fairly."
        />

        <TextInputField
          label="Why should this be reversed?"
          placeholder="Describe your relationship with the referred friend and their real activity…"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={5}
          style={styles.textarea}
        />

        <Text style={styles.sectionTitle}>Attach evidence</Text>
        <View style={styles.chips}>
          {EVIDENCE_PRESETS.map((label) => {
            const on = evidence.includes(label);
            return (
              <Pressable key={label} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleEvidence(label)} accessibilityRole="button">
                {on ? <X size={14} color={Colors.onPrimary} strokeWidth={2.2} /> : <Paperclip size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <DisclosureCard tone="warn" body="Submitting false evidence can lead to account review. Only appeal genuine referrals." />

        <PrimaryButton
          label="Submit appeal"
          onPress={() => appeal.mutate({ clawbackId, reason: reason.trim(), evidence }, { onSuccess: setResult })}
          disabled={!canSubmit}
          loading={appeal.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  chipOn: { backgroundColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
});
