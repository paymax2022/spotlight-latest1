import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, Wallet, ShieldCheck, ChevronRight, Clock, Star, LocateFixed, MapPin, ArrowRight, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import BalanceCard from '@/components/BalanceCard';
import { getWallet } from '@/api/wallet.api';
import { useMobilityHome } from '@/features/mobility/hooks/useMobility';
import ActiveTripCard from '@/features/mobility/components/ActiveTripCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { DRIVER_MODE_ENABLED, QUICK_TILE_REGISTRY, type QuickTileMeta } from '@/features/mobility/constants/mobility.constants';
import { MODE_TILES, type ModeTile } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function MobilityHomeScreen() {
  const home = useMobilityHome();
  // Wallet balance is NOT part of the mobility home payload — read it from the
  // shared wallet feature. Wallet.balance is naira (major units); convert to kobo
  // for formatNaira. undefined-safe so we never render "₦0" from a missing field.
  const wallet = useQuery({ queryKey: ['wallet', 'balance'], queryFn: getWallet, staleTime: 15_000 });

  const goEstimate = (params?: { destAddress?: string; lat?: number; lng?: number }) => {
    const q = params?.destAddress
      ? `?destAddress=${encodeURIComponent(params.destAddress)}&lat=${params.lat}&lng=${params.lng}`
      : '';
    router.push(`/mobility/estimate${q}`);
  };

  // Trip planner state lives in the URL params so the Current location and
  // Where to fields survive the round-trip to the address picker (and work on web).
  const trip = useLocalSearchParams<{
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
    destAddress?: string; lat?: string; lng?: string;
  }>();
  const pickupAddress = trip.pickupAddress ? String(trip.pickupAddress) : '';
  const destAddress = trip.destAddress ? String(trip.destAddress) : '';
  const enc = encodeURIComponent;

  // Open the shared AddressEntry autocomplete for either field, preserving the
  // value already chosen for the other field.
  const pickerHref = (target: 'pickup' | 'destination') => {
    let q = `?target=${target}`;
    if (target === 'pickup' && destAddress) {
      q += `&destAddress=${enc(destAddress)}&lat=${enc(String(trip.lat ?? ''))}&lng=${enc(String(trip.lng ?? ''))}`;
    }
    if (target === 'destination' && pickupAddress) {
      q += `&pickupAddress=${enc(pickupAddress)}&pickupLat=${enc(String(trip.pickupLat ?? ''))}&pickupLng=${enc(String(trip.pickupLng ?? ''))}`;
    }
    return `/mobility/destination${q}`;
  };

  const getEstimate = () => {
    if (!destAddress) return;
    let q = `?destAddress=${enc(destAddress)}&lat=${enc(String(trip.lat ?? ''))}&lng=${enc(String(trip.lng ?? ''))}`;
    if (pickupAddress) {
      q += `&pickupAddress=${enc(pickupAddress)}&pickupLat=${enc(String(trip.pickupLat ?? ''))}&pickupLng=${enc(String(trip.pickupLng ?? ''))}`;
    }
    router.push(`/mobility/estimate${q}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Mobility</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => router.push('/mobility/history')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Trip history">
            <Clock size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {home.isLoading ? (
        <StateView kind="loading" message="Loading mobility…" />
      ) : home.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => home.refetch()} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => home.refetch()} tintColor={Colors.primary} />}
        >
          {/* Uniform wallet card — same design as the app home, with Top up.
              Wrapped in a negative-margin View to cancel the scroll's horizontal
              padding so BalanceCard's own margins align it exactly like on home. */}
          <View style={styles.walletCardWrap}>
            <BalanceCard
              balance={wallet.data?.balance ?? 0}
              currency="NGN"
              quickActions={[
                { id: 'topup', label: 'Top up', icon: <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />, onPress: () => router.push('/wallet/add') },
                { id: 'wallet', label: 'Wallet', icon: <Wallet size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/(tabs)/wallet') },
                { id: 'history', label: 'History', icon: <Clock size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/services/transactions') },
              ]}
            />
          </View>

          {/* Trip planner — Current location + Where to. Both open the same
              AddressEntry autocomplete (Google-powered lookup + confirm-on-map). */}
          <View style={[styles.plannerCard, shadow1]}>
            <Pressable style={styles.plannerRow} onPress={() => router.push(pickerHref('pickup'))} accessibilityLabel="Set current location">
              <View style={styles.plannerDotWrap}><View style={styles.dotOrigin} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.plannerHint}>Current location</Text>
                <Text style={[styles.plannerValue, !pickupAddress && styles.plannerPlaceholder]} numberOfLines={1}>
                  {pickupAddress || 'Set your pickup point'}
                </Text>
              </View>
              <LocateFixed size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
            <View style={styles.plannerDivider} />
            <Pressable style={styles.plannerRow} onPress={() => router.push(pickerHref('destination'))} accessibilityLabel="Where to?">
              <View style={styles.plannerDotWrap}><View style={styles.dotDest} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.plannerHint}>Where to</Text>
                <Text style={[styles.plannerValue, !destAddress && styles.plannerPlaceholder]} numberOfLines={1}>
                  {destAddress || 'Where to?'}
                </Text>
              </View>
              <MapPin size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>

          {destAddress ? (
            <Pressable style={styles.estimateBtn} onPress={getEstimate} accessibilityLabel="Get ride estimate">
              <Text style={styles.estimateBtnLabel}>Get estimate</Text>
              <ArrowRight size={18} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
          ) : null}

          {/* Ride history — labeled entry point (mirrors the header clock icon) so
              riders can quickly rebook a past trip in one tap. */}
          <Pressable style={styles.placeRow} onPress={() => router.push('/mobility/history')} accessibilityLabel="View trip history and rebook a past ride">
            <View style={styles.placeIcon}><Clock size={20} color={Colors.primary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.placeLabel}>Trip history</Text>
              <Text style={styles.placeAddr} numberOfLines={1}>Rebook a past ride in one tap</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>

          {/* Active trip */}
          {home.data?.activeTrip && (
            <View style={styles.section}>
              <ActiveTripCard trip={home.data.activeTrip} onPress={() => router.push(`/mobility/trip/${home.data!.activeTrip!.id}`)} />
            </View>
          )}

          {/* Quick tiles — backend sends string keys; map them to the registry. */}
          <View style={styles.tiles}>
            {(home.data?.quickTiles ?? [])
              .map((key) => QUICK_TILE_REGISTRY[key])
              .filter((tile): tile is QuickTileMeta => Boolean(tile))
              .map((tile) => (
                <QuickTileItem
                  key={tile.id}
                  tile={tile}
                  onPress={() => {
                    if (!tile.enabled) return;
                    if (tile.route) router.push(tile.route as never);
                    else goEstimate();
                  }}
                />
              ))}
          </View>

          {/* More ways to move (new mobility modes) */}
          <SectionHeader title="More ways to move" style={styles.sectionGap} />
          <View style={styles.modeList}>
            {MODE_TILES.map((mode) => (
              <ModeTileRow key={mode.id} mode={mode} onPress={() => mode.enabled && router.push(mode.route as never)} />
            ))}
          </View>

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

function QuickTileItem({ tile, onPress }: { tile: QuickTileMeta; onPress: () => void }) {
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  // Cancels the scroll's horizontal padding so the shared BalanceCard aligns
  // full-width exactly as on the app home.
  walletCardWrap: { marginHorizontal: -Spacing.containerMargin, marginTop: Spacing.xs },
  plannerCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  plannerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  plannerDotWrap: { width: 20, alignItems: 'center', justifyContent: 'center' },
  dotOrigin: { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },
  dotDest: { width: 11, height: 11, borderRadius: 2, backgroundColor: Colors.error },
  plannerDivider: { height: 1, backgroundColor: Colors.outlineVariant, marginLeft: 32 },
  plannerHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  plannerValue: { ...Typography.bodyMd, color: Colors.onSurface },
  plannerPlaceholder: { color: Colors.onSurfaceVariant },
  estimateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  estimateBtnLabel: { ...Typography.labelLg, color: Colors.onPrimary },
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
