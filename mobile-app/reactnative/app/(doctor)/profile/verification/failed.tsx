// PRIVACY: Assisted Mode B verification. This screen shows the doctor only a
// coarse outcome (Rejected) plus high-level, doctor-actionable reason categories.
// It must NEVER render MDCN/register data, reviewer identity, internal reviewer
// notes, or matched-field detail — the doctor never sees the MDCN portal.
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { XCircle, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useVerificationDecision } from '@/features/doctor/hooks';
import { REJECTION_REASONS } from '@/features/doctor/constants';

export default function VerificationFailedScreen() {
  const { data: decision, isLoading, isError, refetch } = useVerificationDecision();

  if (isLoading && !decision) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verification failed" />
        <StateView variant="loading" label="Loading decision" />
      </SafeAreaView>
    );
  }

  if (isError || !decision) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verification failed" />
        <StateView variant="error" message="We could not load your verification result." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  // Reasons attached to the decision, falling back to the catalogue labels.
  const reasons = decision.reasons && decision.reasons.length > 0
    ? decision.reasons
    : REJECTION_REASONS.slice(0, 1);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Verification failed" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <XCircle size={36} color={Colors.error} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Verification unsuccessful</Text>
          <Text style={styles.heroSub}>Please review the reasons below and resubmit the affected documents.</Text>
        </View>

        <SectionCard title="Reasons" style={styles.card}>
          {reasons.map((r, i) => (
            <View key={`${r.code}-${i}`} style={[styles.reasonRow, i > 0 && styles.reasonBorder]}>
              <AlertCircle size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.reasonText}>{r.label}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Decision" style={styles.card}>
          <InfoRow label="Outcome" value="Rejected" valueColor={Colors.error} />
          <InfoRow label="Decided" value={new Date(decision.decidedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
          {/* PRIVACY: reviewer identity and internal notes are intentionally NOT shown. */}
        </SectionCard>

        <PrimaryButton label="Resubmit documents" onPress={() => router.push('/(doctor)/profile/verification/resubmit')} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:         { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:     { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle:    { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:         { marginBottom: Spacing.md },
  reasonRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  reasonBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  reasonText:   { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  btn:          { marginTop: Spacing.sm },
});
