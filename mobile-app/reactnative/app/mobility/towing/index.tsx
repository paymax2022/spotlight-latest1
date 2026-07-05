import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera, Check, AlertTriangle, MapPin, Pencil, X, Truck, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import AddressEntry, { type ConfirmedAddress } from '@/features/mobility/components/AddressEntry';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTowingEstimate, useBookTowing } from '@/features/mobility/hooks/useModes';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import {
  TOWING_SERVICES, TOWING_ISSUES, TOWING_VEHICLE_TYPES, TOWING_ENABLED,
} from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole, formatEta } from '@/features/mobility/utils/mobilityFormatters';
import type { TowingServiceType, TowingIssue, TowingVehicleType, TowingEstimate, Place } from '@/features/mobility/types/modes.types';

const PICKUP: Place = { address: '3rd Mainland Bridge (Lagos-bound)', lat: 6.5, lng: 3.4 };
const DEST: Place = { address: 'AutoWorks Garage, Ikeja', lat: 6.6018, lng: 3.3515 };

export default function TowingHomeScreen() {
  const [serviceType, setServiceType] = useState<TowingServiceType>('flatbed');
  const [issue, setIssue] = useState<TowingIssue>('breakdown');
  const [vehicleType, setVehicleType] = useState<TowingVehicleType>('sedan');
  // Pickup & destination are resolved Places (address + lat/lng) set via the
  // same map + autocomplete address picker as ride booking.
  const [pickup, setPickup] = useState<Place>(PICKUP);
  const [dest, setDest] = useState<Place>(DEST);
  const [editingPickup, setEditingPickup] = useState(false);
  const [editingDest, setEditingDest] = useState(false);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isRoadside = serviceType === 'roadside';
  const estimate = useTowingEstimate();
  const book = useBookTowing();
  const est: TowingEstimate | undefined = estimate.data;
  // Shared chooser: wallet OR card (Paystack top-up) → then the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();

  const pickupPlace: Place = pickup;
  const destPlace: Place | null = isRoadside ? null : dest;

  const onPickupConfirmed = useCallback((addr: ConfirmedAddress) => {
    setPickup({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng });
    setEditingPickup(false);
  }, []);
  const onDestConfirmed = useCallback((addr: ConfirmedAddress) => {
    setDest({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng });
    setEditingDest(false);
  }, []);

  useEffect(() => {
    setSubmitError(null);
    estimate.mutate({ serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, issue, vehicleType, isRoadside, pickup, dest]);

  if (!TOWING_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Tow & rescue" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const onRequest = () => {
    if (!est) return;
    setSubmitError(null);
    pay.start({
      amountKobo: est.totalKobo,
      title: 'Pay for tow & rescue',
      // Existing wallet booking charge (with its Idempotency-Key) runs unchanged.
      charge: () =>
        book.mutateAsync({
          serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType,
          photoUrl: photoTaken ? 'mock://vehicle' : undefined,
          paymentMethod: 'wallet',
        }),
      onPaid: (job) => router.replace(`/mobility/towing/${job.id}`),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Tow & rescue"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/driver/onboarding?service=towing')} hitSlop={8} accessibilityLabel="Offer towing services">
            <Truck size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      {estimate.isError && !est ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => estimate.mutate({ serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Provider upgrade: tow-truck owners can register to receive jobs. */}
            <Pressable
              style={styles.providerCta}
              onPress={() => router.push('/mobility/driver/onboarding?service=towing')}
              accessibilityRole="button"
              accessibilityLabel="Offer towing services"
            >
              <View style={styles.providerCtaIcon}><Truck size={20} color={Colors.primary} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.providerCtaTitle}>Own a tow truck?</Text>
                <Text style={styles.providerCtaSub}>Offer towing van services & earn on Paymax</Text>
              </View>
              <ArrowRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>

            <Text style={styles.section}>Service</Text>
            <View style={styles.list}>
              {TOWING_SERVICES.map((s) => (
                <SelectableCard key={s.value} title={s.label} subtitle={s.hint} icon={s.icon} selected={serviceType === s.value} onPress={() => setServiceType(s.value)} />
              ))}
            </View>

            <Text style={styles.section}>What's the issue?</Text>
            <View style={styles.grid2}>
              {TOWING_ISSUES.map((i) => (
                <View key={i.value} style={styles.gridHalf}>
                  <SelectableCard title={i.label} icon={i.icon} selected={issue === i.value} onPress={() => setIssue(i.value)} />
                </View>
              ))}
            </View>

            <Text style={styles.section}>Vehicle type</Text>
            <View style={styles.chipRow}>
              {TOWING_VEHICLE_TYPES.map((v) => {
                const active = vehicleType === v.value;
                return (
                  <Pressable key={v.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setVehicleType(v.value)}>
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.section}>Your location</Text>
            <AddressRow label="Pickup — where you're stranded" place={pickup} color={Colors.secondary} onPress={() => setEditingPickup(true)} />
            {!isRoadside && (
              <AddressRow label="Tow destination" place={dest} color={Colors.primary} onPress={() => setEditingDest(true)} />
            )}

            <Pressable style={[styles.photoBtn, photoTaken && styles.photoBtnDone]} onPress={() => setPhotoTaken((p) => !p)}>
              <Camera size={18} color={photoTaken ? Colors.tertiaryContainer : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.photoLabel, photoTaken && styles.photoLabelDone]}>{photoTaken ? 'Vehicle photo added' : 'Add a vehicle photo (optional)'}</Text>
              {photoTaken && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
            </Pressable>

            {est && (
              <FareBreakdownCard
                title="Service estimate"
                fareKobo={est.totalKobo}
                rows={[
                  { label: 'Call-out fee', valueKobo: est.calloutKobo },
                  ...(est.distanceKobo > 0 ? [{ label: 'Distance', valueKobo: est.distanceKobo }] : []),
                  { label: 'ETA', valueText: formatEta(est.etaS) },
                ]}
                showTrustNote
              />
            )}

            {submitError && (
              <View style={styles.errRow}><AlertTriangle size={16} color={Colors.error} strokeWidth={2} /><Text style={styles.errText}>{submitError}</Text></View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Total</Text>
              {estimate.isPending && !est ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.fareValue}>{formatNairaWhole(est?.totalKobo ?? 0)}</Text>}
            </View>
            <PrimaryButton label="Request help now" onPress={onRequest} loading={book.isPending} disabled={!est} />
          </View>
        </>
      )}
      {/* Shared wallet/card chooser — drives the booking charge above. */}
      <PaymentSheet controller={pay} />

      {/* Map + autocomplete address pickers (same as ride booking). */}
      <Modal visible={editingPickup} animationType="slide" onRequestClose={() => setEditingPickup(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set your location</Text>
            <Pressable onPress={() => setEditingPickup(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry surface="checkout" initialCenter={{ lat: pickup.lat, lng: pickup.lng }} initialQuery={pickup.address} onConfirmed={onPickupConfirmed} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={editingDest} animationType="slide" onRequestClose={() => setEditingDest(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set tow destination</Text>
            <Pressable onPress={() => setEditingDest(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry surface="checkout" initialCenter={{ lat: dest.lat, lng: dest.lng }} initialQuery={dest.address} onConfirmed={onDestConfirmed} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function AddressRow({ label, place, color, onPress }: { label: string; place: Place; color: string; onPress: () => void }) {
  return (
    <Pressable style={styles.addrRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}>
      <View style={styles.addrIcon}><MapPin size={18} color={color} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addrLabel}>{label}</Text>
        <Text style={styles.addrValue} numberOfLines={1}>{place.address}</Text>
      </View>
      <Pencil size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  list: { gap: Spacing.sm },
  providerCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primaryFixed, borderWidth: 1, borderColor: Colors.primary, marginTop: Spacing.sm },
  providerCtaIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  providerCtaTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  providerCtaSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  addrIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  addrLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addrValue: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const, marginTop: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  modalTitle: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  modalScroll: { padding: Spacing.containerMargin },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridHalf: { width: '48.5%' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.primary },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent, marginTop: Spacing.sm },
  photoBtnDone: { borderColor: Colors.tertiaryContainer, backgroundColor: Colors.tertiaryFixed },
  photoLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  photoLabelDone: { color: Colors.tertiaryContainer },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
