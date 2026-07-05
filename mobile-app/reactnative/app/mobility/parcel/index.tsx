import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Package, Bike, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { PARCEL_ENABLED } from '@/features/mobility/constants/modes.constants';

type Coord = { lat: number; lng: number };

export default function ParcelHomeScreen() {
  const [pickup, setPickup] = useState('');
  const [pickupLoc, setPickupLoc] = useState<Coord | null>(null);
  const [pickupPlus, setPickupPlus] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [dropoffLoc, setDropoffLoc] = useState<Coord | null>(null);
  const [dropoffPlus, setDropoffPlus] = useState('');

  if (!PARCEL_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Send a parcel" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  // Both ends must resolve to map coordinates — the delivery fare is computed
  // from the pickup→drop-off distance, so a typed-only address can't be priced.
  const ready = !!pickupLoc && !!dropoffLoc && !!pickup.trim() && !!dropoff.trim();

  const onContinue = () => {
    if (!ready) return;
    router.push({
      pathname: '/mobility/parcel/describe',
      params: {
        pickup: pickup.trim(),
        dropoff: dropoff.trim(),
        pickupLat: String(pickupLoc!.lat),
        pickupLng: String(pickupLoc!.lng),
        dropoffLat: String(dropoffLoc!.lat),
        dropoffLng: String(dropoffLoc!.lng),
        pickupPlus,
        dropoffPlus,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Send a parcel"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/parcel/courier/requests')} hitSlop={8} accessibilityLabel="Courier mode">
            <Bike size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroIcon}><Package size={24} color={Colors.primary} strokeWidth={2.2} /></View>
          <Text style={styles.heroTitle}>Door-to-door delivery</Text>
          <Text style={styles.heroSub}>Send documents and packages across the city with PIN-verified pickup and drop-off.</Text>
        </View>

        <View style={[styles.card, styles.pickupCard]}>
          <Text style={styles.label}>Pickup</Text>
          <AddressAutocompleteInput
            value={pickup}
            onChangeText={(t) => { setPickup(t); setPickupLoc(null); setPickupPlus(''); }}
            onSelect={(a: SelectedAddress) => { setPickup(a.label); setPickupLoc({ lat: a.lat, lng: a.lng }); setPickupPlus(a.plusCode ?? ''); }}
            resolved={!!pickupLoc}
            surface="delivery"
            placeholder="Where should the courier collect?"
          />
          <View style={{ height: Spacing.sm }} />
          <Text style={styles.label}>Drop-off</Text>
          <AddressAutocompleteInput
            value={dropoff}
            onChangeText={(t) => { setDropoff(t); setDropoffLoc(null); setDropoffPlus(''); }}
            onSelect={(a: SelectedAddress) => { setDropoff(a.label); setDropoffLoc({ lat: a.lat, lng: a.lng }); setDropoffPlus(a.plusCode ?? ''); }}
            near={pickupLoc ?? undefined}
            resolved={!!dropoffLoc}
            surface="delivery"
            placeholder="Where is it going?"
          />
        </View>

        <Pressable style={styles.linkRow} onPress={() => router.push('/mobility/parcel/courier/requests')}>
          <Bike size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.linkText}>I'm a courier — see delivery requests</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        {!ready && (pickup.trim() || dropoff.trim()) ? (
          <Text style={styles.hint}>Pick both addresses from the suggestions so we can price your delivery.</Text>
        ) : null}
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!ready} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6 },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  // Raise the address card so its autocomplete dropdowns overlay the content below.
  pickupCard: { zIndex: 5 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  linkText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
