import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Store, ShieldCheck, ShieldAlert, Star, MapPin, Plus, CalendarClock, Users, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useProviderMe } from '@/features/mobility/hooks/useBusMarketplace';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusProviderRoute, BusProviderSchedule } from '@/features/mobility/types/busProvider.types';

const time = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

export default function BusProviderDashboardScreen() {
  const me = useProviderMe();

  if (me.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Provider" /><StateView kind="loading" message="Loading your business…" /></SafeAreaView>
    );
  }
  if (me.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Provider" /><MobilityEdgeState kind={errKind(me.error)} actionLabel="Retry" onAction={() => me.refetch()} /></SafeAreaView>
    );
  }

  const provider = me.data?.provider;
  if (!provider) {
    // Not yet a provider — funnel to registration.
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Provider" />
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}><Store size={28} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.emptyTitle}>Run an interstate bus service?</Text>
          <Text style={styles.emptySub}>Register your business to list routes, publish departures, and sell seats on the marketplace.</Text>
          <PrimaryButton label="Become a provider" onPress={() => router.push('/mobility/bus/provider/register')} />
        </View>
      </SafeAreaView>
    );
  }

  const routes = me.data!.routes;
  const schedulesByRoute = (routeId: string): BusProviderSchedule[] =>
    me.data!.upcomingSchedules.filter((s) => s.routeId === routeId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Provider dashboard" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => me.refetch()} tintColor={Colors.primary} />}
      >
        {/* Profile */}
        <View style={[styles.profile, shadow1]}>
          <View style={styles.profileHead}>
            <View style={styles.profileIcon}><Store size={22} color={Colors.primary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bizName} numberOfLines={1}>{provider.businessName}</Text>
              <View style={styles.metaRow}>
                <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                <Text style={styles.meta}>{provider.ratingAvg.toFixed(1)}</Text>
                <View style={styles.dot} />
                <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.meta}>{provider.baseState}</Text>
              </View>
            </View>
          </View>
          <View style={[styles.verifyPill, provider.verified ? styles.verifyOn : styles.verifyOff]}>
            {provider.verified
              ? <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              : <ShieldAlert size={14} color={Colors.onWarning} strokeWidth={2.2} />}
            <Text style={[styles.verifyText, provider.verified ? styles.verifyTextOn : styles.verifyTextOff]}>
              {provider.verified ? 'Verified operator' : 'Pending verification'}
            </Text>
          </View>
          <Text style={styles.contact}>{provider.contactPhone}{provider.contactEmail ? ` · ${provider.contactEmail}` : ''}</Text>
          {provider.description ? <Text style={styles.desc}>{provider.description}</Text> : null}
        </View>

        {/* Routes */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Routes</Text>
          <Pressable style={styles.addBtn} onPress={() => router.push('/mobility/bus/provider/route/new')}>
            <Plus size={16} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.addText}>Add route</Text>
          </Pressable>
        </View>

        {routes.length === 0 ? (
          <MobilityEdgeState kind="empty" compact title="No routes yet" message="Add your first route to start publishing departures." />
        ) : (
          routes.map((r) => <RouteBlock key={r.id} route={r} schedules={schedulesByRoute(r.id)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RouteBlock({ route, schedules }: { route: BusProviderRoute; schedules: BusProviderSchedule[] }) {
  return (
    <View style={styles.routeCard}>
      <View style={styles.routeHead}>
        <Text style={styles.routeLine}>{route.fromState} → {route.toState}</Text>
        <Text style={styles.fare}>{formatNairaWhole(route.baseFareKobo)}</Text>
      </View>
      <Text style={styles.terminalLine} numberOfLines={1}>{route.fromCity} → {route.toCity} · {route.busType}</Text>
      {route.amenities.length > 0 && (
        <View style={styles.amenityRow}>
          {route.amenities.slice(0, 5).map((a) => (
            <View key={a} style={styles.amenityPill}><Text style={styles.amenityText}>{a}</Text></View>
          ))}
        </View>
      )}

      {schedules.length > 0 && (
        <View style={styles.scheduleList}>
          {schedules.map((s) => (
            <Pressable
              key={s.id}
              style={styles.scheduleRow}
              onPress={() => router.push(`/mobility/bus/provider/manifest/${s.id}`)}
            >
              <CalendarClock size={16} color={Colors.secondary} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleTime}>{time(s.departureTime)}</Text>
                <Text style={styles.scheduleMeta}>{s.seatsAvailable}/{s.totalSeats} seats · {formatNairaWhole(s.fareKobo)}</Text>
              </View>
              <View style={styles.manifestTag}>
                <Users size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.manifestText}>Manifest</Text>
              </View>
              <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        style={styles.addDeparture}
        onPress={() => router.push(`/mobility/bus/provider/route/${route.id}/schedule`)}
      >
        <Plus size={15} color={Colors.primary} strokeWidth={2.4} />
        <Text style={styles.addDepartureText}>Add departure</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyIcon: { width: 60, height: 60, borderRadius: Radius.lg, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  emptySub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.md },

  profile: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  profileIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  bizName: { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  verifyPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  verifyOn: { backgroundColor: Colors.iconBgTeal },
  verifyOff: { backgroundColor: Colors.iconBgGold },
  verifyText: { ...Typography.labelSm, fontWeight: '700' as const },
  verifyTextOn: { color: Colors.tertiaryContainer },
  verifyTextOff: { color: Colors.onWarning },
  contact: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 21 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed },
  addText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },

  routeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeLine: { ...Typography.labelLg, color: Colors.onSurface },
  fare: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  terminalLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  amenityPill: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  amenityText: { ...Typography.caption, color: Colors.onSurfaceVariant },

  scheduleList: { gap: Spacing.sm, marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, paddingTop: Spacing.sm },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  scheduleTime: { ...Typography.labelMd, color: Colors.onSurface },
  scheduleMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  manifestTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  manifestText: { ...Typography.caption, color: Colors.onSurfaceVariant },

  addDeparture: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.sm, height: 42, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed' },
  addDepartureText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
});
