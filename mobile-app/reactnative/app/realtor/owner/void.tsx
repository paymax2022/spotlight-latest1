import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, TrendingUp, TriangleAlert, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DetailRow from '@/features/realtor/components/DetailRow';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useVoidCandidates, useSetVoidShortlet } from '@/features/realtor/hooks/useRealtorOwner';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

export default function VoidOptimizationScreen() {
  const candidates = useVoidCandidates();
  const setShortlet = useSetVoidShortlet();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Void optimization" subtitle="Earn from vacant units" />

      {candidates.isLoading ? (
        <StateView kind="loading" message="Finding vacant units…" />
      ) : (candidates.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Sparkles" title="No vacant units" message="All your units are earning. We'll flag voids here as they appear." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.banner}>
            <Sparkles size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.bannerText}>
              Vacant long-term units can earn as shortlets while you find a tenant — and flip back automatically when a long-term application is approved.
            </Text>
          </View>

          {candidates.data!.map((c) => (
            <View key={c.unitId} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.unit}>{c.unitLabel}</Text>
                  <Text style={styles.prop}>{c.propertyName} · {c.area}</Text>
                </View>
                <StatusBadge
                  label={c.shortletEnabled ? 'Shortlet on' : `Vacant ${c.vacantDays}d`}
                  tone={c.shortletEnabled ? 'success' : 'warning'}
                  icon={c.shortletEnabled ? 'Sparkles' : 'CalendarClock'}
                />
              </View>

              <View style={styles.projection}>
                <DetailRow label="Recommended nightly" value={`${formatNaira(c.recommendedNightly)} / night`} />
                <DetailRow label="Projected void revenue" value={`${formatNaira(c.projectedMonthlyVoidRevenue)} / mo`} emphasis />
              </View>

              {c.longTermConflict ? (
                <View style={styles.conflict}>
                  <TriangleAlert size={14} color={Colors.onWarning} strokeWidth={2.2} />
                  <Text style={styles.conflictText}>
                    A long-term application is in progress — shortlet nights are blocked around the proposed move-in date.
                  </Text>
                </View>
              ) : (
                <View style={styles.upside}>
                  <TrendingUp size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                  <Text style={styles.upsideText}>
                    ~{formatNaira(c.projectedMonthlyVoidRevenue - c.monthlyRent)} more than idle long-term rent this month.
                  </Text>
                </View>
              )}

              <PrimaryButton
                label={c.shortletEnabled ? 'Disable shortlet' : 'Enable shortlet'}
                variant={c.shortletEnabled ? 'secondary' : 'primary'}
                onPress={() => setShortlet.mutate({ unitId: c.unitId, enabled: !c.shortletEnabled })}
                loading={setShortlet.isPending && setShortlet.variables?.unitId === c.unitId}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, paddingBottom: Spacing.xxl, gap: Spacing.md },
  banner: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.primaryFixed,
    borderRadius: Radius.lg, padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.onPrimaryFixed, flex: 1, lineHeight: 20 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm, ...shadow1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  unit: { ...Typography.titleMd, color: Colors.onSurface },
  prop: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  projection: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md },
  conflict: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  conflictText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  upside: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  upsideText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
});
