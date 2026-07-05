import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Users, Activity, GraduationCap, KeyRound, UserPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatDate } from '@/features/academy/constants';
import { useSchoolOverview } from '@/features/academy/hooks';
import type { LicenceStatus } from '@/features/academy/types';

const LICENCE_META: Record<LicenceStatus, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',   color: Colors.teal,      bg: Colors.iconBgTeal },
  expiring: { label: 'Expiring', color: Colors.onWarning, bg: Colors.iconBgGold },
  expired:  { label: 'Expired',  color: Colors.error,     bg: Colors.errorContainer },
};

/** T8 (detail) — School overview: class dashboards, licence, bulk-enrol overview. */
export default function SchoolOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const overview = useSchoolOverview(id);

  if (overview.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading overview…" /></SafeAreaView>;
  if (overview.isError || !overview.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="School" /><StateView kind="error" title="Could not load overview" /></SafeAreaView>;

  const o = overview.data;
  const lic = LICENCE_META[o.school.licenceStatus];
  const activePct = Math.round((o.activeLearners7d / Math.max(1, o.totalLearners)) * 100);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={o.school.name} subtitle={`${o.school.lga}, ${o.school.state}`} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Top stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, shadow1]}><Users size={18} color={Colors.secondary} /><Text style={styles.statNum}>{o.totalLearners}</Text><Text style={styles.statLabel}>learners</Text></View>
          <View style={[styles.statCard, shadow1]}><Activity size={18} color={Colors.teal} /><Text style={styles.statNum}>{activePct}%</Text><Text style={styles.statLabel}>active 7d</Text></View>
          <View style={[styles.statCard, shadow1]}><GraduationCap size={18} color={Colors.gold} /><Text style={styles.statNum}>{o.avgMasteryPct}%</Text><Text style={styles.statLabel}>mastery</Text></View>
        </View>

        {/* Licence */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <View style={styles.cardHeadLeft}><KeyRound size={16} color={Colors.primary} /><Text style={styles.cardTitle}>Licence</Text></View>
            <Chip label={lic.label} color={lic.color} bg={lic.bg} small />
          </View>
          <View style={styles.seatRow}>
            <Text style={styles.seatLabel}>Seats used</Text>
            <Text style={styles.seatVal}>{o.school.seatsUsed} / {o.school.seatsTotal}</Text>
          </View>
          <ProgressBar pct={Math.round((o.school.seatsUsed / o.school.seatsTotal) * 100)} style={{ marginTop: 6 }} />
          <Text style={styles.renews}>Renews {formatDate(o.school.licenceRenewsAt)}</Text>
        </View>

        {/* Bulk enrol overview */}
        <View style={[styles.inviteCard, shadow1]}>
          <UserPlus size={18} color={Colors.secondary} />
          <Text style={styles.inviteText}>{o.pendingInvites} bulk-enrol invites pending acceptance.</Text>
        </View>

        {/* Class dashboards */}
        <Text style={styles.section}>Class dashboards</Text>
        {o.classes.map((c) => (
          <View key={c.id} style={[styles.classCard, shadow1]}>
            <View style={styles.classHead}>
              <Text style={styles.className}>{c.name}</Text>
              <Text style={styles.classEnrolled}>{c.enrolled} enrolled</Text>
            </View>
            <View style={styles.classMetrics}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Active 7d</Text>
                <ProgressBar pct={c.activePct} color={Colors.teal} style={{ marginTop: 4 }} />
                <Text style={styles.metricVal}>{c.activePct}%</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Avg mastery</Text>
                <ProgressBar pct={c.avgMasteryPct} color={Colors.gold} style={{ marginTop: 4 }} />
                <Text style={styles.metricVal}>{c.avgMasteryPct}%</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statNum: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  seatRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  seatLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  seatVal: { ...Typography.labelMd, color: Colors.onSurface },
  renews: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 6 },
  inviteCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  inviteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  classCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  classHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  className: { ...Typography.titleMd, color: Colors.onSurface },
  classEnrolled: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  classMetrics: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  metric: { flex: 1 },
  metricLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  metricVal: { ...Typography.labelSm, color: Colors.onSurface, marginTop: 2 },
});
