import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Palette, Users, ChartColumn, Banknote, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useAmbassadorDashboard } from '@/features/referral/ambassador/hooks';

// M-AMB-01 — Ambassador dashboard: advanced funnel clicks → conversion → earnings.
const LINKS = [
  { label: 'Creative toolkit', icon: Palette, route: '/referral/ambassador/creative-toolkit' },
  { label: 'Referred audience', icon: Users, route: '/referral/ambassador/audience' },
  { label: 'Performance analytics', icon: ChartColumn, route: '/referral/ambassador/analytics' },
  { label: 'Payouts', icon: Banknote, route: '/referral/ambassador/payouts' },
  { label: 'Tier progression', icon: BadgeCheck, route: '/referral/ambassador/tier-progression' },
] as const;

export default function AmbassadorDashboardScreen() {
  const { data, isLoading, isError, refetch } = useAmbassadorDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ambassador Zone" subtitle="Advanced earning tools" />
      {isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Earnings snapshot */}
          <View style={styles.snapshot}>
            <Text style={styles.snapTier}>{data.tier} ambassador</Text>
            <Text style={styles.snapValue}>{formatNaira(data.earnedKobo)}</Text>
            <Text style={styles.snapLabel}>Lifetime earnings · from verified activity</Text>
            <View style={styles.snapSplit}>
              <View style={styles.snapCol}><Text style={styles.snapColLabel}>Pending</Text><Text style={styles.snapColValue}>{formatNaira(data.pendingKobo)}</Text></View>
              <View style={styles.snapDivider} />
              <View style={styles.snapCol}><Text style={styles.snapColLabel}>Ready</Text><Text style={styles.snapColValue}>{formatNaira(data.eligibleKobo)}</Text></View>
              <View style={styles.snapDivider} />
              <View style={styles.snapCol}><Text style={styles.snapColLabel}>Conv. rate</Text><Text style={styles.snapColValue}>{Math.round(data.conversionRate * 100)}%</Text></View>
            </View>
          </View>

          {/* Funnel */}
          <Text style={styles.sectionTitle}>Funnel</Text>
          <View style={styles.funnel}>
            {data.funnel.map((f, i) => {
              const max = data.funnel[0].value || 1;
              const pct = Math.max(0.08, f.value / max);
              return (
                <View key={f.key} style={styles.funnelRow}>
                  <Text style={styles.funnelLabel}>{f.label}</Text>
                  <View style={styles.funnelBarWrap}>
                    <View style={[styles.funnelBar, { width: `${Math.round(pct * 100)}%` }]} />
                  </View>
                  <View style={styles.funnelValues}>
                    <Text style={styles.funnelValue}>{f.value.toLocaleString('en-NG')}</Text>
                    {f.conversion != null ? <Text style={styles.funnelConv}>{Math.round(f.conversion * 100)}%</Text> : null}
                  </View>
                  {i < data.funnel.length - 1 ? <View style={styles.funnelGap} /> : null}
                </View>
              );
            })}
          </View>

          <DisclosureCard
            tone="compliant"
            title="Activity-based earnings"
            body="Your ambassador earnings come from the verified activity of the people you refer — never from recruitment or signups alone."
          />

          {/* Quick links */}
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
  snapshot: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg, gap: 2 },
  snapTier: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  snapValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  snapLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  snapSplit: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  snapCol: { flex: 1, alignItems: 'center' },
  snapColLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  snapColValue: { ...Typography.labelLg, color: Colors.onSurface },
  snapDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceContainerHigh },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  funnel: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  funnelRow: { gap: 4 },
  funnelLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  funnelBarWrap: { height: 26, borderRadius: Radius.sm, backgroundColor: Colors.surfaceContainerLow, overflow: 'hidden', justifyContent: 'center' },
  funnelBar: { height: 26, borderRadius: Radius.sm, backgroundColor: Colors.primary, minWidth: 8 },
  funnelValues: { flexDirection: 'row', justifyContent: 'space-between' },
  funnelValue: { ...Typography.labelMd, color: Colors.onSurface },
  funnelConv: { ...Typography.caption, color: Colors.tertiaryContainer },
  funnelGap: { height: 2 },
  links: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  linkBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  linkIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
