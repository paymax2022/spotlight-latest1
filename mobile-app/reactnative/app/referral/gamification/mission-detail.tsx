import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Check, Circle, Sparkles, Coins, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { showToast } from '@/store/toastStore';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useMissionDetail, useClaimMission } from '@/features/referral/gamification/hooks';

// M-GAM-02 — Mission detail & progress. Steps, progress, reward (points NON-CASH).
export default function MissionDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { data, isLoading, isError, refetch } = useMissionDetail(id);
  const claim = useClaimMission();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Mission" />
      {isLoading ? (
        <StateView kind="loading" message="Loading mission…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="This mission could not be found." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>{data.title}</Text>
            <Text style={styles.blurb}>{data.blurb}</Text>
            {data.endsAt ? <Text style={styles.ends}>Ends {relativeTime(data.endsAt)}</Text> : <Text style={styles.ends}>Evergreen quest</Text>}
          </View>

          {/* Progress */}
          <View style={styles.progressCard}>
            <View style={styles.progressTop}>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressCount}>{data.stepsDone}/{data.stepsTotal} steps</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(data.progress * 100)}%` }]} /></View>
          </View>

          {/* Reward — points NON-CASH, cash separate */}
          <Text style={styles.sectionTitle}>Reward</Text>
          <View style={styles.rewardCard}>
            <View style={styles.rewardItem}>
              <View style={styles.rewardIcon}><Sparkles size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.rewardText}>
                <Text style={styles.rewardValue}>{data.reward.points} points</Text>
                <Text style={styles.rewardSub}>Non-cash status reward — never converted to money</Text>
              </View>
            </View>
            {data.reward.cashKobo != null ? (
              <View style={styles.rewardItem}>
                <View style={[styles.rewardIcon, styles.rewardIconCash]}><Coins size={18} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
                <View style={styles.rewardText}>
                  <Text style={styles.rewardValue}>{formatNaira(data.reward.cashKobo)} cash</Text>
                  <Text style={styles.rewardSub}>Paid only on your friend's verified activity</Text>
                </View>
              </View>
            ) : null}
            {data.reward.badge ? (
              <View style={styles.rewardItem}>
                <View style={[styles.rewardIcon, styles.rewardIconBadge]}><Award size={18} color={Colors.onWarning} strokeWidth={2} /></View>
                <View style={styles.rewardText}>
                  <Text style={styles.rewardValue}>{data.reward.badge} badge</Text>
                  <Text style={styles.rewardSub}>Status badge on completion</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Steps */}
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={styles.steps}>
            {data.steps.map((s, i) => (
              <View key={s.id} style={[styles.step, i < data.steps.length - 1 && styles.stepBorder]}>
                <View style={[styles.stepDot, s.done ? styles.stepDotDone : styles.stepDotPending]}>
                  {s.done ? <Check size={13} color={Colors.white} strokeWidth={3} /> : <Circle size={9} color={Colors.outline} strokeWidth={2} />}
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepLabel, !s.done && styles.stepLabelPending]}>{s.label}</Text>
                  {s.hint ? <Text style={styles.stepHint}>{s.hint}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          <DisclosureCard tone="compliant" title="Why this is compliant" body={data.explanation} />

          {data.status === 'completed' ? (
            <PrimaryButton
              label="Claim reward"
              onPress={() =>
                claim.mutate(id, {
                  onError: () =>
                    showToast({
                      variant: 'error',
                      title: 'Could not claim this mission',
                      message: 'Please try again.',
                    }),
                })
              }
              loading={claim.isPending}
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  header: { gap: 4 },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  blurb: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  ends: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  progressCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { ...Typography.labelMd, color: Colors.onSurface },
  progressCount: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  track: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.primary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  rewardCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.md },
  rewardItem: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  rewardIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  rewardIconCash: { backgroundColor: Colors.iconBgTeal },
  rewardIconBadge: { backgroundColor: Colors.iconBgGold },
  rewardText: { flex: 1 },
  rewardValue: { ...Typography.labelLg, color: Colors.onSurface },
  rewardSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  steps: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  step: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.md },
  stepBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  stepDot: { width: 24, height: 24, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: Colors.primary },
  stepDotPending: { backgroundColor: Colors.surfaceContainerHigh },
  stepBody: { flex: 1 },
  stepLabel: { ...Typography.labelMd, color: Colors.onSurface },
  stepLabelPending: { color: Colors.onSurfaceVariant },
  stepHint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
