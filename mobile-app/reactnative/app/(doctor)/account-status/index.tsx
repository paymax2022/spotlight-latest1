import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, CheckCircle2, XCircle, Eye, Ban } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useAccountStatus } from '@/features/doctor/hooks';
import { ACCOUNT_STATE_LABELS } from '@/features/doctor/constants';
import type { AccountState } from '@/types/doctor.batch7';

// ── Section AD — Account-status gate (pending / rejected / suspended / review) ──
// Dedicated full-screen gate driven by useAccountStatus. Renders the state's
// title/message + a practice-status badge. Also links the other AD gates
// (session-expired, access-denied) so reviewers can reach every gate. Reuses
// StatusBadge / InfoRow.

const STATE_ICON: Record<AccountState, LucideIcon> = {
  unsubmitted:  Clock,
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

export default function AccountStatusScreen() {
  const { data: status, isLoading, isError, refetch } = useAccountStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Account Status" />
      {isLoading && !status ? (
        <StateView variant="loading" label="Checking account status" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not check your account status." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const Icon = STATE_ICON[status.state];
            return (
              <View style={styles.hero}>
                <View style={[styles.heroIcon, { backgroundColor: STATE_BG[status.state] }]}>
                  <Icon size={32} color={status.canPractise ? Colors.teal : Colors.error} strokeWidth={2} />
                </View>
                <Text style={styles.heroTitle}>{status.title}</Text>
                <Text style={styles.heroSub}>{status.message}</Text>
              </View>
            );
          })()}

          <SectionCard style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>State</Text>
              <StatusBadge label={ACCOUNT_STATE_LABELS[status.state]} tone={STATE_TONE[status.state]} />
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Can practise</Text>
              <StatusBadge label={status.canPractise ? 'Yes' : 'No'} tone={status.canPractise ? 'success' : 'danger'} />
            </View>
            <InfoRow label="Updated" value={new Date(status.updatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
          </SectionCard>

          {status.state === 'under_review' && (
            <PrimaryButton label="View review notice" onPress={() => router.push('/(doctor)/compliance/account-review')} style={styles.btn} />
          )}
          {(status.state === 'rejected' || status.state === 'unsubmitted') && (
            <PrimaryButton label="View verification status" onPress={() => router.push('/(doctor)/signup/pending')} style={styles.btn} />
          )}

          <Text style={styles.groupTitle}>Other gates</Text>
          <View style={styles.menu}>
            <ProfileMenuItem icon="Clock" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Session expired" onPress={() => router.push('/(doctor)/account-status/session-expired')} />
            <View style={styles.divider} />
            <ProfileMenuItem icon="Lock" iconColor={Colors.error} bgColor={Colors.errorContainer} label="Access denied" onPress={() => router.push('/(doctor)/account-status/access-denied')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:       { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg },
  heroIcon:   { width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle:  { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroSub:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:       { marginBottom: Spacing.md },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  label:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  btn:        { marginTop: Spacing.xs, marginBottom: Spacing.md },
  groupTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  menu:       { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider:    { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
});
