import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Eye, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import { useAccountReviewNotice } from '@/features/doctor/hooks';
import { ACCOUNT_REVIEW_REASON_LABELS } from '@/features/doctor/constants';

// ── Section AB — Account review notice (AB.15, also AD account-review) ──────────
// NEW screen: surfaces an active account-review notice (reason / restriction /
// expected-by) or a reassuring empty state when none is active. Reuses
// SectionCard / InfoRow / StatusBadge.

export default function AccountReviewScreen() {
  const { data: notice, isLoading, isError, refetch } = useAccountReviewNotice();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Account Review" />
      {isLoading ? (
        <StateView variant="loading" label="Checking review status" />
      ) : isError ? (
        <StateView variant="error" message="We could not load the review status." onRetry={() => refetch()} />
      ) : !notice ? (
        <StateView variant="empty" icon={ShieldCheck} title="No active review" message="Your account is not under review." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Eye size={32} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.heroTitle}>{notice.title}</Text>
            <Text style={styles.heroSub}>{notice.message}</Text>
          </View>

          <SectionCard title="Review details" style={styles.card}>
            <InfoRow label="Reason" value={ACCOUNT_REVIEW_REASON_LABELS[notice.reason]} />
            <View style={styles.statusRow}>
              <Text style={styles.label}>Practice status</Text>
              <StatusBadge label={notice.restrictsPractice ? 'Restricted' : 'Active'} tone={notice.restrictsPractice ? 'danger' : 'success'} />
            </View>
            <InfoRow label="Opened" value={new Date(notice.openedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            {!!notice.expectedBy && <InfoRow label="Expected by" value={new Date(`${notice.expectedBy}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
          </SectionCard>

          <PrimaryButton label="Contact support" onPress={() => router.push(notice.contactRoute ?? '/(doctor)/support')} style={styles.btn} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg },
  heroIcon:  { width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue, marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  label:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  btn:       { marginTop: Spacing.sm },
});
