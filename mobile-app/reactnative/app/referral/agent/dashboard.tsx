import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, UserPlus, Users, ScrollText, Trophy, GraduationCap, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useTeamDashboard } from '@/features/referral/agent/hooks';

// M-AGT-01 — Team / network dashboard. Network activity + ACTIVITY-BASED override
// summary. Override displays MUST show: % of verified network ACTIVITY (not
// recruitment), caps, and the activity-based disclosure.
const LINKS = [
  { label: 'Onboard sub-referrers', icon: UserPlus, route: '/referral/agent/onboard-subs' },
  { label: 'Team members', icon: Users, route: '/referral/agent/member-detail' },
  { label: 'Override earnings ledger', icon: ScrollText, route: '/referral/agent/override-ledger' },
  { label: 'Team leaderboard & targets', icon: Trophy, route: '/referral/agent/team-leaderboard' },
  { label: 'Training & resources', icon: GraduationCap, route: '/referral/agent/training' },
  { label: 'Earnings disclosure', icon: ShieldCheck, route: '/referral/agent/disclosure' },
] as const;

export default function AgentDashboardScreen() {
  const { data, isLoading, isError, refetch } = useTeamDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Team / Agent Zone" subtitle="Activity-based overrides" />
      {isLoading ? (
        <StateView kind="loading" message="Loading team…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Network summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.teamName}>{data.teamName}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCol}><Text style={styles.summaryValue}>{data.memberCount}</Text><Text style={styles.summaryLabel}>Members</Text></View>
              <View style={styles.summaryCol}><Text style={styles.summaryValue}>{data.activeMemberCount}</Text><Text style={styles.summaryLabel}>Active</Text></View>
              <View style={styles.summaryCol}><Text style={styles.summaryValue}>{formatNaira(data.networkActivityKobo)}</Text><Text style={styles.summaryLabel}>Verified activity</Text></View>
            </View>
          </View>

          {/* Override summary — explicit % of verified ACTIVITY + cap */}
          <View style={styles.overrideCard}>
            <Text style={styles.overrideLabel}>Override earned this period</Text>
            <Text style={styles.overrideValue}>{formatNaira(data.overrideEarnedKobo)}</Text>
            <Text style={styles.overrideBasis}>
              = {Math.round(data.overrideRate * 100)}% of your network's VERIFIED activity ({formatNaira(data.networkActivityKobo)}). Based on real transactions — not on recruiting people.
            </Text>
            {/* Cap usage */}
            <View style={styles.capRow}>
              <Text style={styles.capLabel}>Cap used</Text>
              <Text style={styles.capValue}>{formatNaira(data.capUsedKobo)} / {formatNaira(data.overrideCapKobo)}</Text>
            </View>
            <View style={styles.capTrack}>
              <View style={[styles.capFill, { width: `${Math.min(100, Math.round((data.capUsedKobo / data.overrideCapKobo) * 100))}%` }]} />
            </View>
          </View>

          <DisclosureCard
            tone="compliant"
            title="How overrides work"
            body="Your override is a capped percentage of the verified activity and revenue of your network members. You earn nothing for signing people up — only when they genuinely use Paymax. This is not a multi-level recruitment scheme."
          />

          <View style={styles.links}>
            {LINKS.map((l, i) => (
              <Pressable key={l.label} style={[styles.link, i < LINKS.length - 1 && styles.linkBorder]} onPress={() => router.push(l.route as never)} accessibilityRole="button">
                <View style={styles.linkIcon}><l.icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                <Text style={styles.linkLabel}>{l.label}</Text>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  teamName: { ...Typography.titleMd, color: Colors.onSurface },
  summaryRow: { flexDirection: 'row' },
  summaryCol: { flex: 1, alignItems: 'center', gap: 2 },
  summaryValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const, textAlign: 'center' },
  summaryLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  overrideCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  overrideLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  overrideValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  overrideBasis: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  capLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  capValue: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' as const },
  capTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  capFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.gold },
  links: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  linkBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  linkIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
