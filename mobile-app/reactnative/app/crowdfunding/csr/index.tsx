import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, BadgeCheck, HandCoins, ChevronRight, BarChart3, ReceiptText, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EdgeState from '@/features/crowdfunding/components/EdgeState';
import CampaignStatusBadge from '@/features/crowdfunding/components/CampaignStatusBadge';
import { CSR_ENABLED } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { useCsrProfile, useMatches } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira, formatNairaCompact } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { CsrMatchStatus } from '@/features/crowdfunding/types/csr.types';

const MATCH_BADGE: Record<CsrMatchStatus, { label: string; fg: string; bg: string }> = {
  DRAFT: { label: 'Draft', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  PENDING_APPROVAL: { label: 'Pending approval', fg: '#B65A00', bg: Colors.iconBgOrange },
  ACTIVE: { label: 'Active', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  COMPLETED: { label: 'Completed', fg: Colors.secondary, bg: Colors.iconBgBlue },
  PAUSED: { label: 'Paused', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export default function CsrHome() {
  if (!CSR_ENABLED) {
    return (
      <EdgeState
        icon="Building2"
        title="CSR partnerships coming soon"
        message="Corporate CSR and matching donations open once your organisation completes partner onboarding with Spotlight. Contact your account manager to get started."
        primaryLabel="Back to campaigns"
        onPrimary={() => router.replace('/crowdfunding')}
      />
    );
  }
  return <CsrHomeEnabled />;
}

function CsrHomeEnabled() {
  const { data: p, isLoading, isError, refetch } = useCsrProfile();
  const matches = useMatches();

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><Header /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !p) return <SafeAreaView style={styles.safe} edges={['top']}><Header /><StateView kind="error" title="Couldn't load CSR dashboard" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  const remaining = p.annualBudgetKobo - p.committedKobo;
  const active = (matches.data ?? []).filter((m) => m.status === 'ACTIVE' || m.status === 'PENDING_APPROVAL');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header company={p.companyName} verified={p.verified} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Budget card */}
        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>CSR budget remaining</Text>
          <Text style={styles.budgetValue}>{formatNaira(remaining)}</Text>
          <View style={styles.budgetRow}>
            <Bud label="Annual" value={formatNairaCompact(p.annualBudgetKobo)} />
            <View style={styles.budgetDivider} />
            <Bud label="Committed" value={formatNairaCompact(p.committedKobo)} />
            <View style={styles.budgetDivider} />
            <Bud label="Matched" value={formatNairaCompact(p.matchedKobo)} />
          </View>
        </View>

        <View style={styles.browse}><PrimaryButton label="Browse impact campaigns to match" onPress={() => router.push('/crowdfunding/csr/campaigns')} /></View>

        {/* Quick links */}
        <View style={styles.quickRow}>
          <Quick icon={<BarChart3 size={18} color={Colors.primary} strokeWidth={2} />} label="Impact" onPress={() => router.push('/crowdfunding/csr/reports')} />
          <Quick icon={<ReceiptText size={18} color={Colors.secondary} strokeWidth={2} />} label="Invoices" onPress={() => router.push('/crowdfunding/csr/invoices')} />
          <Quick icon={<Users size={18} color={Colors.teal} strokeWidth={2} />} label="Staff giving" onPress={() => router.push('/crowdfunding/csr/employee-giving')} />
        </View>

        {/* Active matches */}
        <View style={styles.matchesHead}>
          <Text style={styles.sectionTitle}>Your matches</Text>
          <Pressable onPress={() => router.push('/crowdfunding/csr/matches')} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable>
        </View>
        {matches.isLoading ? (
          <StateView kind="loading" compact />
        ) : active.length === 0 ? (
          <StateView kind="empty" compact icon="HandCoins" title="No active matches" message="Match a campaign to multiply contributions." />
        ) : (
          active.map((m) => {
            const meta = MATCH_BADGE[m.status];
            return (
              <Pressable key={m.id} style={styles.matchRow} onPress={() => router.push('/crowdfunding/csr/matches')} accessibilityRole="button">
                <View style={styles.matchBody}>
                  <Text style={styles.matchTitle} numberOfLines={1}>{m.campaignTitle}</Text>
                  <Text style={styles.matchMeta}>{m.ratio} match · {formatNairaCompact(m.matchedKobo)} of {formatNairaCompact(m.capKobo)}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ company, verified }: { company?: string; verified?: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} /></Pressable>
      <View style={styles.headerTitleWrap}>
        <Text style={styles.eyebrow}>Corporate CSR</Text>
        <View style={styles.companyRow}>
          <Text style={styles.headerTitle} numberOfLines={1}>{company ?? 'Sponsor dashboard'}</Text>
          {verified && <BadgeCheck size={16} color={Colors.secondary} strokeWidth={2.2} />}
        </View>
      </View>
    </View>
  );
}

function Bud({ label, value }: { label: string; value: string }) {
  return (<View style={styles.bud}><Text style={styles.budColLabel}>{label}</Text><Text style={styles.budColValue}>{value}</Text></View>);
}
function Quick({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quick} onPress={onPress} accessibilityRole="button">
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flexShrink: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  budgetCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.sm },
  budgetLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  budgetValue: { ...Typography.headlineLg, color: Colors.onPrimary, marginTop: 2 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  bud: { flex: 1 },
  budColLabel: { ...Typography.caption, color: Colors.inversePrimary },
  budColValue: { ...Typography.labelLg, color: Colors.onPrimary, marginTop: 2 },
  budgetDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  browse: { marginTop: Spacing.md },
  quickRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  quick: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  quickIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface },
  matchesHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  matchBody: { flex: 1, gap: 4 },
  matchTitle: { ...Typography.labelLg, color: Colors.onSurface },
  matchMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
});
