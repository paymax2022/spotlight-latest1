import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Sparkles, ChevronRight, Building2, TriangleAlert, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useOwnerDashboard } from '@/features/realtor/hooks/useRealtorOwner';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';
import type { OwnerMetric } from '@/features/realtor/types/realtor.owner.types';

const TONE_COLOR: Record<NonNullable<OwnerMetric['tone']>, string> = {
  success: Colors.tertiaryContainer,
  warning: Colors.onWarning,
  error: Colors.error,
  neutral: Colors.onSurface,
};

export default function OwnerDashboardScreen() {
  const dash = useOwnerDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Owner dashboard"
        subtitle="Your portfolio at a glance"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/realtor/admin/moderation')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Moderation queue">
              <ShieldCheck size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push('/realtor/owner/create')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add property">
              <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      {dash.isLoading ? (
        <StateView kind="loading" message="Loading your cockpit…" />
      ) : dash.isError ? (
        <StateView kind="error" title="Couldn't load dashboard" actionLabel="Retry" onAction={() => dash.refetch()} />
      ) : !dash.data ? null : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={dash.isRefetching} onRefresh={dash.refetch} tintColor={Colors.primary} />}
        >
          {/* Metrics grid */}
          <View style={styles.metrics}>
            {dash.data.metrics.map((m) => (
              <View key={m.key} style={styles.metric}>
                <Text style={[styles.metricValue, { color: TONE_COLOR[m.tone ?? 'neutral'] }]}>{m.value}</Text>
                <Text style={styles.metricLabel}>{m.label}</Text>
                {m.hint ? <Text style={styles.metricHint}>{m.hint}</Text> : null}
              </View>
            ))}
          </View>

          {/* Void optimization promo */}
          {dash.data.voidCandidateCount > 0 ? (
            <Pressable style={styles.voidCard} onPress={() => router.push('/realtor/owner/void')}>
              <View style={styles.voidIcon}>
                <Sparkles size={20} color={Colors.onPrimary} strokeWidth={2} />
              </View>
              <View style={styles.voidBody}>
                <Text style={styles.voidTitle}>Stop {dash.data.voidCandidateCount} vacant unit{dash.data.voidCandidateCount > 1 ? 's' : ''} bleeding money</Text>
                <Text style={styles.voidSub}>Auto-list as shortlet while you find a long-term tenant.</Text>
              </View>
              <ChevronRight size={20} color={Colors.onPrimaryContainer} strokeWidth={2} />
            </Pressable>
          ) : null}

          {/* Properties */}
          <SectionHeader title="Properties" actionLabel="Add" onAction={() => router.push('/realtor/owner/create')} />
          <View style={styles.propList}>
            {dash.data.properties.map((p) => (
              <Pressable key={p.id} style={styles.propCard} onPress={() => router.push(`/realtor/owner/unit/add?propertyId=${p.id}`)}>
                <Image source={{ uri: p.coverUrl }} style={styles.propThumb} />
                <View style={styles.propBody}>
                  <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.propMeta}>{p.area}, {p.city} · {p.occupiedCount}/{p.unitCount} occupied</Text>
                  <View style={styles.propStats}>
                    <Text style={styles.propRent}>{formatNaira(p.monthlyRent)}/mo</Text>
                    {p.arrears > 0 ? (
                      <View style={styles.arrears}>
                        <TriangleAlert size={12} color={Colors.error} strokeWidth={2.2} />
                        <Text style={styles.arrearsText}>{formatNaira(p.arrears)} arrears</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ))}
          </View>

          {dash.data.properties.length === 0 ? (
            <StateView kind="empty" icon="Building2" title="No properties yet" message="Add your first property to start earning." actionLabel="Add property" onAction={() => router.push('/realtor/owner/create')} compact />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  metric: {
    width: '47.5%', flexGrow: 1,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...shadow1,
  },
  metricValue: { ...Typography.headlineMd, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metricHint: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  voidCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg,
    padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
  },
  voidIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  voidBody: { flex: 1 },
  voidTitle: { ...Typography.labelLg, color: Colors.onPrimaryFixed },
  voidSub: { ...Typography.bodySm, color: Colors.onPrimaryFixedVariant },
  propList: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  propCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.sm, ...shadow1,
  },
  propThumb: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  propBody: { flex: 1, gap: 2 },
  propName: { ...Typography.labelLg, color: Colors.onSurface },
  propMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  propStats: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  propRent: { ...Typography.labelMd, color: Colors.tertiaryContainer },
  arrears: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrearsText: { ...Typography.labelSm, color: Colors.error },
});
