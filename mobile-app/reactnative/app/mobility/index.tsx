import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, Wallet, Search, ShieldCheck, ChevronRight, Clock, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import { useMobilityHome } from '@/features/mobility/hooks/useMobility';
import ActiveTripCard from '@/features/mobility/components/ActiveTripCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { DRIVER_MODE_ENABLED } from '@/features/mobility/constants/mobility.constants';
import { MODE_TILES, type ModeTile } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import type { QuickTile, SavedPlace, Place } from '@/features/mobility/types/mobility.types';

export default function MobilityHomeScreen() {
  const home = useMobilityHome();

  const goEstimate = (params?: { destAddress?: string; lat?: number; lng?: number }) => {
    const q = params?.destAddress
      ? `?destAddress=${encodeURIComponent(params.destAddress)}&lat=${params.lat}&lng=${params.lng}`
      : '';
    router.push(`/mobility/estimate${q}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Mobility</Text>
        </View>
        <Pressable onPress={() => router.push('/mobility/history')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Trip history">
          <Clock size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      {home.isLoading ? (
        <StateView kind="loading" message="Loading mobility…" />
      ) : home.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => home.refetch()} />
      ) : home.data && !home.data.serviceAvailable ? (
        <MobilityEdgeState kind="serviceUnavailable" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => home.refetch()} tintColor={Colors.primary} />}
        >
          {/* Wallet widget (reuses existing wallet balance) */}
          <View style={[styles.walletCard, shadow1]}>
            <View style={styles.walletIcon}><Wallet size={20} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletLabel}>Paymax wallet</Text>
              <Text style={styles.walletBalance}>{formatNaira(home.data?.walletBalanceKobo ?? 0)}</Text>
            </View>
            <Pressable onPress={() => router.push('/wallet/add')} style={styles.topUpBtn}>
              <Text style={styles.topUpLabel}>Top up</Text>
            </Pressable>
          </View>

          {/* Where to */}
          <Pressable style={styles.searchBar} onPress={() => goEstimate()} accessibilityLabel="Where to?">
            <Search size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.searchText}>Where to?</Text>
          </Pressable>

          {/* Active trip */}
          {home.data?.activeTrip && (
            <View style={styles.section}>
              <ActiveTripCard trip={home.data.activeTrip} onPress={() => router.push(`/mobility/trip/${home.data!.activeTrip!.id}`)} />
            </View>
          )}

          {/* Quick tiles */}
          <View style={styles.tiles}>
            {(home.data?.quickTiles ?? []).map((tile) => (
              <QuickTileItem key={tile.id} tile={tile} onPress={() => tile.enabled && goEstimate()} />
            ))}
          </View>

          {/* More ways to move (new mobility modes) */}
          <SectionHeader title="More ways to move" style={styles.sectionGap} />
          <View style={styles.modeList}>
            {MODE_TILES.map((mode) => (
              <ModeTileRow key={mode.id} mode={mode} onPress={() => mode.enabled && router.push(mode.route as never)} />
            ))}
          </View>

          {/* Saved places */}
          {(home.data?.savedPlaces.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Saved places" style={styles.sectionGap} />
              <View style={styles.list}>
                {home.data!.savedPlaces.map((p) => (
                  <PlaceRow key={p.id} place={p} onPress={() => goEstimate({ destAddress: p.address, lat: p.lat, lng: p.lng })} />
                ))}
              </View>
            </>
          )}

          {/* Recent */}
          {(home.data?.recentPlaces.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Recent" style={styles.sectionGap} />
              <View style={styles.list}>
                {home.data!.recentPlaces.map((p, i) => (
                  <RecentRow key={`${p.address}-${i}`} place={p} onPress={() => goEstimate({ destAddress: p.address, lat: p.lat, lng: p.lng })} />
                ))}
              </View>
            </>
          )}

          {/* Safety reminder */}
          <View style={styles.safetyCard}>
            <ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2.2} />
            <Text style={styles.safetyText}>{home.data?.safetyReminder}</Text>
          </View>

          {/* Driver mode entry (role-gated within the same app) */}
          {DRIVER_MODE_ENABLED && (
            <Pressable style={styles.driverBanner} onPress={() => router.push('/mobility/driver')} accessibilityLabel="Switch to driver mode">
              <View style={styles.driverIcon}><Star size={18} color={Colors.onPrimary} strokeWidth={2.2} fill={Colors.onPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverTitle}>Drive with Paymax</Text>
                <Text style={styles.driverSub}>Go online and earn on your schedule</Text>
              </View>
              <ChevronRight size={20} color={Colors.onPrimary} />
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function QuickTileItem({ tile, onPress }: { tile: QuickTile; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[tile.icon] ?? Icons.Car;
  return (
    <Pressable style={[styles.tile, !tile.enabled && styles.tileDisabled]} onPress={onPress} disabled={!tile.enabled}>
      <View style={styles.tileIcon}><Icon size={22} color={tile.enabled ? Colors.primary : Colors.outline} strokeWidth={2} /></View>
      <Text style={[styles.tileLabel, !tile.enabled && styles.tileLabelDisabled]}>{tile.label}</Text>
      {!tile.enabled && <Text style={styles.soon}>Soon</Text>}
    </Pressable>
  );
}

function ModeTileRow({ mode, onPress }: { mode: ModeTile; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[mode.icon] ?? Icons.Car;
  return (
    <Pressable style={[styles.placeRow, !mode.enabled && styles.tileDisabled]} onPress={onPress} disabled={!mode.enabled} accessibilityRole="button" accessibilityLabel={mode.label}>
      <View style={styles.placeIcon}><Icon size={20} color={mode.enabled ? Colors.primary : Colors.outline} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.placeLabel}>{mode.label}</Text>
        <Text style={styles.placeAddr} numberOfLines={1}>{mode.description}</Text>
      </View>
      {mode.enabled ? <ChevronRight size={18} color={Colors.onSurfaceVariant} /> : <Text style={styles.soon}>Soon</Text>}
    </Pressable>
  );
}

function PlaceRow({ place, onPress }: { place: SavedPlace; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[place.icon ?? 'MapPin'] ?? Icons.MapPin;
  return (
    <Pressable style={styles.placeRow} onPress={onPress}>
      <View style={styles.placeIcon}><Icon size={18} color={Colors.secondary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.placeLabel}>{place.label}</Text>
        <Text style={styles.placeAddr} numberOfLines={1}>{place.address}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

function RecentRow({ place, onPress }: { place: Place; onPress: () => void }) {
  return (
    <Pressable style={styles.placeRow} onPress={onPress}>
      <View style={styles.placeIcon}><Clock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
      <Text style={[styles.placeAddr, { flex: 1, color: Colors.onSurface }]} numberOfLines={1}>{place.address}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  walletCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginTop: Spacing.xs },
  walletIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  walletLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  walletBalance: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  topUpBtn: { paddingHorizontal: Spacing.md, height: 38, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  topUpLabel: { ...Typography.labelMd, color: Colors.primary },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  searchText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  section: {},
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  tileDisabled: { opacity: 0.6 },
  tileIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  tileLabelDisabled: { color: Colors.onSurfaceVariant },
  soon: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionGap: { marginTop: Spacing.sm },
  list: { gap: Spacing.sm },
  modeList: { gap: Spacing.sm },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  placeIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  placeLabel: { ...Typography.labelMd, color: Colors.onSurface },
  placeAddr: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  safetyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.tertiaryFixed, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  safetyText: { ...Typography.labelSm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  driverBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  driverIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  driverTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  driverSub: { ...Typography.labelSm, color: Colors.inversePrimary },
});
