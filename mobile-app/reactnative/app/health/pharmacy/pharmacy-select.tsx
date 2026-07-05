import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Star, Store, Truck, Package, Map, LocateFixed } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { usePharmacies } from '@/features/health/pharmacy/hooks';
import { useDeviceCoords } from '@/features/health/pharmacy/useDeviceCoords';
import { useCartStore } from '@/features/health/pharmacy/cartStore';
import { formatNaira } from '@/features/health/constants/health.constants';

type SortMode = 'distance' | 'rating';

export default function PharmacySelectScreen() {
  const { coords, request, requesting, error: locError, available: locAvailable } = useDeviceCoords();
  const [sort, setSort] = useState<SortMode>('distance');
  // Search by pharmacy name. `search` is the live input; `q` is debounced so we
  // don't refetch on every keystroke (server-side ILIKE via usePharmacies).
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isLoading, isError, refetch } = usePharmacies({ lat: coords?.lat, lng: coords?.lng, sort, q: q || undefined });
  const [selected, setSelected] = useState<string | null>(null);
  const setPharmacy = useCartStore((s) => s.setPharmacy);

  // Ask for location once on mount so distance sort works out of the box;
  // degrades to rating sort (server-resolved) if denied/unavailable.
  useEffect(() => {
    if (locAvailable && !coords) {
      request();
    } else if (!locAvailable) {
      setSort('rating');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locAvailable]);

  const onContinue = () => {
    const ph = (data ?? []).find((p) => p.id === selected);
    if (!ph) return;
    setPharmacy(ph.id, ph.deliveryFeeKobo);
    router.push('/health/pharmacy/checkout');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose a pharmacy" subtitle="Verified, near you" />

      <SearchBar
        placeholder="Search by pharmacy name…"
        value={search}
        onChangeText={setSearch}
      />

      {isLoading ? (
        <StateView kind="loading" message="Finding pharmacies…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load pharmacies" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (data ?? []).length === 0 ? (
        q ? (
          <StateView kind="empty" icon="Store" title="No matches" message={`No pharmacies found for “${q}”. Try a different name.`} />
        ) : (
          <StateView kind="empty" icon="Store" title="No pharmacies nearby" message="Try again later or change your location." />
        )
      ) : (
        <>
          {/* Location / sort strip */}
          <View style={styles.map}>
            <Map size={22} color={Colors.secondary} strokeWidth={1.6} />
            <Text style={styles.mapText}>
              {coords
                ? 'Verified pharmacies near you'
                : locError
                  ? locError
                  : 'Sorted by rating — enable location for distance'}
            </Text>
            {!coords && locAvailable ? (
              <Pressable style={styles.locateBtn} onPress={() => { request(); setSort('distance'); }} hitSlop={8}>
                <LocateFixed size={14} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.locateText}>{requesting ? 'Locating…' : 'Use my location'}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Sort toggle */}
          <View style={styles.sortRow}>
            {(['distance', 'rating'] as SortMode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.sortChip, sort === m && styles.sortChipActive]}
                onPress={() => setSort(m)}
                disabled={m === 'distance' && !coords}
              >
                <Text style={[styles.sortChipText, sort === m && styles.sortChipTextActive]}>
                  {m === 'distance' ? 'Nearest' : 'Top rated'}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {(data ?? []).map((p) => {
              const isSel = p.id === selected;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.card, shadow1, isSel && styles.cardSel]}
                  onPress={() => setSelected(p.id)}
                >
                  <View style={styles.cardHead}>
                    <View style={styles.storeIcon}>
                      <Store size={20} color={Colors.primary} strokeWidth={2} />
                    </View>
                    <View style={styles.cardTitleWrap}>
                      <Text style={styles.name}>{p.name}</Text>
                      <View style={styles.metaRow}>
                        <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                        <Text style={styles.meta}>
                          {p.rating.toFixed(1)} ({p.reviewCount})
                        </Text>
                        {coords ? (
                          <>
                            <Text style={styles.dot}>·</Text>
                            <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                            <Text style={styles.meta}>{p.distanceKm} km</Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                    <View style={[styles.radio, isSel && styles.radioSel]}>{isSel ? <View style={styles.radioDot} /> : null}</View>
                  </View>

                  <CredentialBadge credential={p.credential} showLicense />
                  <Text style={styles.address} numberOfLines={1}>
                    {p.address}
                  </Text>

                  <View style={styles.fulfilRow}>
                    {p.supportsDelivery ? (
                      <View style={styles.fulfil}>
                        <Truck size={13} color={Colors.secondary} strokeWidth={2} />
                        <Text style={styles.fulfilText}>
                          {p.etaLabel} · {formatNaira(p.deliveryFeeKobo)}
                        </Text>
                      </View>
                    ) : null}
                    {p.supportsPickup ? (
                      <View style={styles.fulfil}>
                        <Package size={13} color={Colors.teal} strokeWidth={2} />
                        <Text style={styles.fulfilText}>Pickup</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label="Continue to checkout" onPress={onContinue} disabled={!selected} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  map: {
    height: 110,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: Spacing.md },
  locateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locateText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
  sortRow: { flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  sortChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  sortChipActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  sortChipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sortChipTextActive: { color: Colors.primary, fontWeight: '600' as const },
  content: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardSel: { borderColor: Colors.primary, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  storeIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleWrap: { flex: 1 },
  name: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { color: Colors.outline },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSel: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  address: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fulfilRow: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' },
  fulfil: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fulfilText: { ...Typography.labelSm, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
