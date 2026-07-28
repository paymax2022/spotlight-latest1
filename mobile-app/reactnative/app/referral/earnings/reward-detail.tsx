import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Circle, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { EarnStatePill, DisclosureCard } from '@/features/referral/components';
import { formatNaira, formatNairaPrecise, relativeTime } from '@/features/referral/constants/format';
import { useRewardDetail } from '@/features/referral/earnings/hooks';

// M-ERN-02 — Reward detail: which referral/action, amount, status, timeline.
const ACTION_LABEL: Record<string, string> = {
  kyc_completed: 'Completed KYC',
  first_transaction: 'First transaction',
  retained_30d: 'Retained 30 days',
  retained_60d: 'Retained 60 days',
  retained_90d: 'Retained 90 days',
  mission_complete: 'Mission completed',
};

export default function RewardDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { data, isLoading, isError, refetch } = useRewardDetail(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward detail" />
      {isLoading ? (
        <StateView kind="loading" message="Loading reward…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="This reward could not be found." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.amountCard}>
            <Text style={styles.amountValue}>{formatNairaPrecise(data.amountKobo)}</Text>
            <EarnStatePill state={data.state} />
          </View>

          <View style={styles.infoCard}>
            <InfoRow label="From" value={data.inviteeName ?? 'Referral mission'} />
            <InfoRow label="Qualifying action" value={ACTION_LABEL[data.qualifyingAction] ?? data.qualifyingAction} />
            <InfoRow label="Type" value={kindLabel(data.kind)} />
            <InfoRow label="Created" value={relativeTime(data.createdAt)} last />
          </View>

          <DisclosureCard tone="compliant" title="Why you earned this" body={data.explanation} />

          {/* State timeline */}
          <Text style={styles.sectionTitle}>Status timeline</Text>
          <View style={styles.timeline}>
            {data.timeline.map((t, i) => (
              <View key={`${t.state}-${i}`} style={styles.tlRow}>
                <View style={styles.tlRail}>
                  <View style={[styles.tlDot, t.done ? styles.tlDotDone : styles.tlDotPending]}>
                    {t.done ? <Check size={12} color={Colors.white} strokeWidth={3} /> : <Circle size={8} color={Colors.outline} strokeWidth={2} />}
                  </View>
                  {i < data.timeline.length - 1 && <View style={[styles.tlLine, t.done && styles.tlLineDone]} />}
                </View>
                <View style={styles.tlBody}>
                  <Text style={[styles.tlLabel, !t.done && styles.tlLabelPending]}>{t.label}</Text>
                  {t.at ? <Text style={styles.tlTime}>{relativeTime(t.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          {data.state === 'vesting' && (
            <Pressable style={styles.link} onPress={() => router.push('/referral/earnings/vesting-tracker')} accessibilityRole="button">
              <Text style={styles.linkText}>View vesting schedule</Text>
              <ChevronRight size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}
          {data.state === 'eligible' && (
            <Pressable style={styles.link} onPress={() => router.push('/referral/earnings/withdraw')} accessibilityRole="button">
              <Text style={styles.linkText}>Withdraw {formatNaira(data.amountKobo)} to wallet</Text>
              <ChevronRight size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}
          {data.state === 'clawed_back' && (
            <Pressable style={styles.link} onPress={() => router.push('/referral/earnings/clawback-notice')} accessibilityRole="button">
              <Text style={styles.linkText}>Why was this reversed?</Text>
              <ChevronRight size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function kindLabel(k: string): string {
  switch (k) {
    case 'referrer': return 'Referrer reward';
    case 'referee': return 'Welcome reward';
    case 'override': return 'Team override';
    case 'mission': return 'Mission reward';
    case 'manual': return 'Manual adjustment';
    default: return k;
  }
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  amountCard: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg },
  amountValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  infoCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  infoBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  infoLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  infoValue: { ...Typography.labelMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  timeline: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  tlRow: { flexDirection: 'row', gap: Spacing.sm },
  tlRail: { alignItems: 'center', width: 24 },
  tlDot: { width: 24, height: 24, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: Colors.primary },
  tlDotPending: { backgroundColor: Colors.surfaceContainerHigh },
  tlLine: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  tlLineDone: { backgroundColor: Colors.primary },
  tlBody: { flex: 1, paddingBottom: Spacing.md },
  tlLabel: { ...Typography.labelMd, color: Colors.onSurface },
  tlLabelPending: { color: Colors.onSurfaceVariant },
  tlTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingVertical: Spacing.md },
  linkText: { ...Typography.labelLg, color: Colors.primary },
});
