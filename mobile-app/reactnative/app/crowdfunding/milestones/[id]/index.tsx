import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Lock, Loader, FileSearch, ChevronRight, BarChart3 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { CampaignMilestone } from '@/features/crowdfunding/types/crowdfunding.types';

const META: Record<CampaignMilestone['status'], { label: string; fg: string; bg: string; icon: React.ReactNode }> = {
  RELEASED: { label: 'Released', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal, icon: <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} /> },
  ACTIVE: { label: 'Active', fg: Colors.secondary, bg: Colors.iconBgBlue, icon: <Loader size={16} color={Colors.secondary} strokeWidth={2.4} /> },
  PENDING_REVIEW: { label: 'Under review', fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple, icon: <FileSearch size={16} color={Colors.onPrimaryFixedVariant} strokeWidth={2.4} /> },
  LOCKED: { label: 'Locked', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, icon: <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2.4} /> },
};

export default function MilestoneDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  const released = (c?.milestones ?? []).filter((m) => m.status === 'RELEASED').length;
  const total = c?.milestones.length ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Milestones" subtitle="Manage releases & evidence" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load milestones" actionLabel="Retry" onAction={refetch} />
      ) : c.milestones.length === 0 ? (
        <StateView kind="empty" icon="Flag" title="No milestones" message="This campaign doesn't use milestone funding." />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <Text style={styles.summaryValue}>{released}/{total}</Text>
            <Text style={styles.summaryLabel}>milestones released · {progressPct(c.raisedKobo, c.goalKobo)}% funded</Text>
          </View>

          {c.milestones.map((m, i) => {
            const meta = META[m.status];
            return (
              <Pressable key={m.id} style={styles.row} onPress={() => router.push(`/crowdfunding/milestones/${id}/${m.id}`)} accessibilityRole="button">
                <View style={styles.timeline}>
                  <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>{meta.icon}</View>
                  {i < c.milestones.length - 1 && <View style={styles.line} />}
                </View>
                <View style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{m.title}</Text>
                    <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                  </View>
                  <Text style={styles.target}>Releases at {formatNaira(m.targetKobo)} · {m.evidenceCount} evidence</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
              </Pressable>
            );
          })}

          <View style={styles.impactBtn}>
            <PrimaryButton label="Create impact report" variant="secondary" onPress={() => router.push(`/crowdfunding/milestones/${id}/impact`)} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, alignItems: 'center' },
  summaryValue: { ...Typography.headlineMd, color: Colors.onSurface },
  summaryLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', gap: Spacing.md },
  timeline: { alignItems: 'center', width: 40 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 4 },
  card: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.md, gap: 6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  target: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  impactBtn: { marginTop: Spacing.sm },
});
