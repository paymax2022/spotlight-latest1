import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Star, ShieldCheck, MapPin, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusProviderDetail } from '@/features/mobility/hooks/useBusMarketplace';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusProviderRoute } from '@/features/mobility/types/busProvider.types';

const time = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

export default function BusProviderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useBusProviderDetail(id);
  const p = detail.data?.provider;

  if (detail.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Operator" /><StateView kind="loading" message="Loading operator…" /></SafeAreaView>
    );
  }
  if (detail.isError || !p) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Operator" /><MobilityEdgeState kind={errKind(detail.error)} actionLabel="Retry" onAction={() => detail.refetch()} /></SafeAreaView>
    );
  }

  const bookRoute = (r: BusProviderRoute) => {
    router.push({
      pathname: '/mobility/bus',
      params: { tab: 'book', fromState: r.fromState, toState: r.toState, providerId: p.id },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={p.businessName} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.header, shadow1]}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{p.businessName}</Text>
            {p.verified && (
              <View style={styles.verifiedBadge}>
                <ShieldCheck size={12} color={Colors.tertiaryContainer} strokeWidth={2.4} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
            <Text style={styles.meta}>{p.ratingAvg.toFixed(1)}</Text>
            <View style={styles.dot} />
            <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.meta}>Based in {p.baseState}</Text>
            <View style={styles.dot} />
            <Text style={styles.meta}>{p.routeCount} route{p.routeCount === 1 ? '' : 's'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Routes</Text>
        {detail.data!.routes.length === 0 ? (
          <MobilityEdgeState kind="empty" compact title="No routes yet" message="This operator has not published any routes." />
        ) : (
          detail.data!.routes.map((r) => (
            <View key={r.id} style={styles.routeCard}>
              <View style={styles.routeHead}>
                <Text style={styles.routeLine}>{r.fromState} → {r.toState}</Text>
                <Text style={styles.fare}>{formatNairaWhole(r.baseFareKobo)}</Text>
              </View>
              <Text style={styles.terminalLine} numberOfLines={1}>{r.fromCity} → {r.toCity} · {r.busType}</Text>
              <Text style={styles.departLine}>{r.nextDepartureTime ? `Next departure ${time(r.nextDepartureTime)}` : 'No upcoming departures'}</Text>
              {r.amenities.length > 0 && (
                <View style={styles.amenityRow}>
                  {r.amenities.slice(0, 4).map((a) => (
                    <View key={a} style={styles.amenityPill}><Text style={styles.amenityText}>{a}</Text></View>
                  ))}
                </View>
              )}
              <Pressable style={styles.bookBtn} onPress={() => bookRoute(r)} accessibilityRole="button">
                <Text style={styles.bookText}>Book this route</Text>
                <ArrowRight size={16} color={Colors.primary} strokeWidth={2} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  header: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface, flexShrink: 1 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  routeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeLine: { ...Typography.labelLg, color: Colors.onSurface },
  fare: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  terminalLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  departLine: { ...Typography.labelSm, color: Colors.secondary },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  amenityPill: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  amenityText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  bookBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.sm, height: 44, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  bookText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
});
