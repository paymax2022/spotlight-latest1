import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, CheckCircle2, XCircle, Eye, Ban, ChevronRight, FileClock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useOnboardingAccountStatus } from '@/features/doctor/hooks';
import type { AccountState } from '@/types/doctor.onboarding';

// ── Section A · Entries 17–20 — Post-submission account state (REUSE) ─────────
// Terminal step of the onboarding flow. Reads the account state via
// useOnboardingAccountStatus (REUSE of the Batch 7 account-status query — no new
// account-status screen is created) and surfaces pending / rejected / suspended
// / under_review. The full gate detail lives on the existing Batch 7
// account-status screens, which this links to (no recreation).

const STATE_ICON: Record<AccountState, LucideIcon> = {
  unsubmitted:  FileClock,
  pending:      Clock,
  approved:     CheckCircle2,
  rejected:     XCircle,
  under_review: Eye,
  needs_info:   Eye,
  suspended:    Ban,
};

const STATE_TONE: Record<AccountState, StatusTone> = {
  unsubmitted:  'neutral',
  pending:      'warning',
  approved:     'success',
  rejected:     'danger',
  under_review: 'warning',
  needs_info:   'warning',
  suspended:    'danger',
};

const STATE_BG: Record<AccountState, string> = {
  unsubmitted:  Colors.surfaceContainerLow,
  pending:      Colors.iconBgBlue,
  approved:     Colors.iconBgTeal,
  rejected:     Colors.errorContainer,
  under_review: Colors.iconBgBlue,
  needs_info:   Colors.iconBgBlue,
  suspended:    Colors.errorContainer,
};

export default function OnboardingSubmitScreen() {
  const { data: status, isLoading, isError, refetch } = useOnboardingAccountStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Submission status" />

      {isLoading && !status ? (
        <StateView variant="loading" label="Checking your status" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not check your account status." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const Icon = STATE_ICON[status.state];
            return (
              <View style={styles.hero}>
                <View style={[styles.heroIcon, { backgroundColor: STATE_BG[status.state] }]}>
                  <Icon size={36} color={status.canPractise ? Colors.teal : Colors.error} strokeWidth={2} />
                </View>
                <Text style={styles.heroTitle}>{status.title}</Text>
                <Text style={styles.heroSub}>{status.message}</Text>
              </View>
            );
          })()}

          <SectionCard style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>State</Text>
              <StatusBadge label={status.state.replace('_', ' ')} tone={STATE_TONE[status.state]} />
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Can practise</Text>
              <StatusBadge label={status.canPractise ? 'Yes' : 'No'} tone={status.canPractise ? 'success' : 'danger'} />
            </View>
            <InfoRow label="Updated" value={new Date(status.updatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
          </SectionCard>

          {/* Entries 17–20 detail live on the existing Batch 7 gate — link, don't recreate. */}
          <Pressable
            onPress={() => router.push('/(doctor)/account-status')}
            style={styles.gateLink}
            accessibilityRole="button"
            accessibilityLabel="View full account status"
          >
            <View style={styles.gateIcon}>
              <Eye size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.gateBody}>
              <Text style={styles.gateTitle}>View full account status</Text>
              <Text style={styles.gateSub}>Pending, rejected, suspended & review details</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          <PrimaryButton label="Refresh status" variant="secondary" onPress={() => refetch()} style={styles.btn} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:  { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  label:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  gateLink:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  gateIcon:  { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  gateBody:  { flex: 1, gap: 2 },
  gateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  gateSub:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  btn:       { marginTop: Spacing.xs },
});
