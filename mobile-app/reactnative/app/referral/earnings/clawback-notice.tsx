import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard, StateBadge } from '@/features/referral/components';
import { formatNaira, relativeTime, formatCountdown } from '@/features/referral/constants/format';
import { useClawbackNotice } from '@/features/referral/earnings/hooks';

// M-ERN-08 — Clawback / dispute notice: why a reward was reversed + appeal.
export default function ClawbackNoticeScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { data, isLoading, isError, refetch } = useClawbackNotice(params.id);

  const appealCountdown = data?.appealDeadline ? formatCountdown(data.appealDeadline) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward reversed" />
      {isLoading ? (
        <StateView kind="loading" message="Loading notice…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.iconWrap}><CircleAlert size={24} color={Colors.error} strokeWidth={2} /></View>
            <Text style={styles.amount}>−{formatNaira(data.amountKobo)}</Text>
            <Text style={styles.heroSub}>Reversed {relativeTime(data.reversedAt)}</Text>
            <StateBadge label={data.reasonLabel} tone="danger" />
          </View>

          <DisclosureCard tone="warn" title="What happened" body={data.explanation} />

          <View style={styles.infoCard}>
            <Row label="From" value={data.inviteeName ?? '—'} />
            <Row label="Reason" value={data.reasonLabel} />
            <Row label="Reversed" value={relativeTime(data.reversedAt)} last />
          </View>

          <DisclosureCard
            tone="info"
            body="Clawbacks happen when a referral turns out not to be genuine — for example a self-referral, a fake account, or a duplicate identity. This keeps the program fair for everyone."
          />

          {data.appealStatus && data.appealStatus !== 'none' ? (
            <DisclosureCard tone="info" title="Appeal status" body={appealStatusCopy(data.appealStatus)} />
          ) : data.appealable ? (
            <View style={{ gap: Spacing.sm }}>
              {appealCountdown && <Text style={styles.deadline}>You have {appealCountdown} to appeal</Text>}
              <PrimaryButton
                label="Appeal this clawback"
                onPress={() => router.push({ pathname: '/referral/earnings/appeal-clawback', params: { id: data.id } })}
              />
            </View>
          ) : (
            <DisclosureCard tone="warn" body="The appeal window for this clawback has closed." />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function appealStatusCopy(status: string): string {
  switch (status) {
    case 'submitted': return 'Your appeal has been submitted and is queued for review.';
    case 'in_review': return 'Your appeal is being reviewed. We will notify you of the outcome.';
    case 'upheld': return 'After review, the clawback was upheld. The reversal stands.';
    case 'overturned': return 'Your appeal was successful — the reward has been restored.';
    default: return '';
  }
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.lg },
  iconWrap: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  amount: { ...Typography.displayLg, color: Colors.error, fontWeight: '800' as const },
  heroSub: { ...Typography.bodySm, color: Colors.error },
  infoCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
  deadline: { ...Typography.labelMd, color: Colors.onWarning, textAlign: 'center' },
});
