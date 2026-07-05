import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PromoBanner from '@/components/PromoBanner';
import StateView from '@/components/StateView';
import { useStatePride } from '@/features/arena/hooks';
import { lastUpdatedLabel, formatNaira } from '@/features/arena/constants';

/**
 * S6 — State Pride leaderboard. 36 states + FCT ranked by aggregate fan SUPPORT
 * (real Naira). This tally feeds the prize pot + State Pride award — it NEVER
 * affects judging or the crown (NDC-1). Offline-tolerant "last updated" stamp.
 */
export default function StatePrideScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  const pride = useStatePride(competitionId);

  const states = pride.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="State Pride" subtitle="States ranked by fan support" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pride.isRefetching} onRefresh={pride.refetch} tintColor={Colors.primary} />}
      >
        {/* Banner — sits directly under the heading, above the standings. */}
        <View style={styles.bannerWrap}>
          <PromoBanner
            badge="STATE PRIDE"
            title="Rep your state 🏁"
            subtitle="Back your state’s drivers — every naira lifts them up the board."
            cta="Back a driver"
            onPress={() => router.push({ pathname: '/arena', params: { competitionId } })}
          />
        </View>

        {pride.isLoading ? (
          <StateView kind="loading" />
        ) : pride.isError ? (
          <StateView kind="error" title="Couldn’t load State Pride" actionLabel="Retry" onAction={() => pride.refetch()} />
        ) : states.length === 0 ? (
          <StateView kind="empty" title="No support yet" message="Standings appear once fans start backing drivers." />
        ) : (
          <>
            <View style={styles.explainer}>
              <Text style={styles.explainerText}>
                States are ranked by total fan support (₦) for their drivers. This fuels the prize pot and the
                State Pride award — it does not affect judging or the crown.
              </Text>
            </View>
            <Text style={styles.stamp}>{lastUpdatedLabel(new Date().toISOString())}</Text>
            <View style={[styles.card, shadow1]}>
              {states.map((s) => (
                <View key={s.state} style={styles.row}>
                  <Text style={[styles.rank, s.rank <= 3 && styles.rankTop]}>{s.rank}</Text>
                  <View style={styles.stateIcon}><MapPin size={16} color={Colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stateName}>{s.state}</Text>
                    <Text style={styles.stateMeta}>{s.contestants} driver{s.contestants === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={styles.amountCol}>
                    <Text style={styles.points}>{formatNaira(s.supportKobo)}</Text>
                    <Text style={styles.pointsCaption}>in support</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  // Cancel the content's horizontal padding so PromoBanner's own margin aligns it
  // flush with the standings card below.
  bannerWrap: { marginHorizontal: -Spacing.containerMargin },
  explainer: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  explainerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  stamp: { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  amountCol: { alignItems: 'flex-end' },
  pointsCaption: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  rank: { ...Typography.titleMd, color: Colors.onSurfaceVariant, width: 26, textAlign: 'center' },
  rankTop: { color: Colors.gold, fontWeight: '800' as const },
  stateIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  stateName: { ...Typography.labelLg, color: Colors.onSurface },
  stateMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  points: { ...Typography.titleMd, color: Colors.primary },
});
