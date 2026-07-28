// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { bookRide, estimateRide } from '@/api/transport.api';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { RideEstimate, RideBooking } from '@/types/fintech';

const VEHICLE_TYPES = [
  { key: 'economy', label: 'Economy', icon: 'car-outline', desc: 'Affordable rides' },
  { key: 'comfort', label: 'Comfort', icon: 'car-sport-outline', desc: 'More spacious' },
  { key: 'suv', label: 'SUV', icon: 'bus-outline', desc: 'Up to 6 passengers' },
];

export default function TransportScreen() {
  const router = useRouter();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [selected, setSelected] = useState('economy');
  const [estimates, setEstimates] = useState<RideEstimate[] | null>(null);
  const [booking, setBooking] = useState<RideBooking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const estimateMutation = useMutation({
    mutationFn: () =>
      estimateRide({
        pickup_lat: 6.5244,
        pickup_lng: 3.3792,
        dropoff_lat: 6.4281,
        dropoff_lng: 3.4219,
      }),
    onSuccess: (data) => setEstimates(data),
    onError: (err: any) => setError(err?.message || 'Could not get estimates'),
  });

  const bookMutation = useMutation({
    mutationFn: () =>
      bookRide({
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim(),
        pickup_lat: 6.5244,
        pickup_lng: 3.3792,
        dropoff_lat: 6.4281,
        dropoff_lng: 3.4219,
        vehicle_type: selected,
      }),
    onSuccess: (data) => setBooking(data),
    onError: (err: any) => setError(err?.message || 'Booking failed'),
  });

  if (booking) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <Ionicons name="car" size={72} color={colors.secondary.DEFAULT} />
        <Text style={styles.successTitle}>Ride Booked!</Text>
        <Text style={styles.successSub}>Driver en route • ETA {booking.eta_min} min</Text>
        <View style={styles.driverCard}>
          <Text style={styles.driverName}>{booking.driver_name}</Text>
          <Text style={styles.driverMeta}>{booking.vehicle} · {booking.plate}</Text>
        </View>
        <Pressable style={styles.doneBtn} onPress={() => router.replace('/(tabs)/index' as never)}>
          <Text style={styles.doneBtnText}>Back to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Transport & Rides</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Map Placeholder */}
        <View style={styles.mapPlaceholder}>
          <Ionicons name="map" size={48} color="rgba(0,81,213,0.3)" />
          <Text style={styles.mapText}>Map view</Text>
        </View>

        {/* Pickup / Dropoff */}
        <View style={styles.addressCard}>
          <View style={styles.addressRow}>
            <View style={[styles.dot, { backgroundColor: '#00B894' }]} />
            <TextInput
              style={styles.addressInput}
              placeholder="Pickup location"
              placeholderTextColor={colors.neutral.placeholder}
              value={pickup}
              onChangeText={setPickup}
            />
          </View>
          <View style={styles.addressDivider} />
          <View style={styles.addressRow}>
            <View style={[styles.dot, { backgroundColor: '#dc2626' }]} />
            <TextInput
              style={styles.addressInput}
              placeholder="Where to?"
              placeholderTextColor={colors.neutral.placeholder}
              value={dropoff}
              onChangeText={setDropoff}
            />
          </View>
        </View>

        {/* Vehicle Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vehicle Type</Text>
          {VEHICLE_TYPES.map((v) => {
            const est = estimates?.find((e) => e.vehicle_type === v.key);
            return (
              <Pressable
                key={v.key}
                style={[styles.vehicleRow, selected === v.key && styles.vehicleRowActive]}
                onPress={() => setSelected(v.key)}
              >
                <View style={styles.vehicleIcon}>
                  <Ionicons name={v.icon as never} size={22} color={selected === v.key ? colors.secondary.DEFAULT : colors.neutral.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.vehicleLabel, selected === v.key && styles.vehicleLabelActive]}>{v.label}</Text>
                  <Text style={styles.vehicleDesc}>{v.desc}</Text>
                </View>
                {est ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.vehiclePrice}>{formatCurrency(est.price_kobo, 'NGN')}</Text>
                    <Text style={styles.vehicleEta}>{est.eta_min} min</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
                )}
              </Pressable>
            );
          })}
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!estimates ? (
          <Pressable
            style={[styles.primaryBtn, estimateMutation.isPending && styles.primaryBtnDisabled]}
            disabled={estimateMutation.isPending}
            onPress={() => {
              setError(null);
              if (!pickup.trim() || !dropoff.trim()) { setError('Please enter pickup and dropoff'); return; }
              estimateMutation.mutate();
            }}
          >
            {estimateMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Get Estimates</Text>}
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, bookMutation.isPending && styles.primaryBtnDisabled]}
            disabled={bookMutation.isPending}
            onPress={() => { setError(null); bookMutation.mutate(); }}
          >
            {bookMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Book {VEHICLE_TYPES.find((v) => v.key === selected)?.label}</Text>}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.secondary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  mapPlaceholder: {
    height: 180, backgroundColor: '#EEF2FF', borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  mapText: { fontSize: 14, color: colors.neutral.textMuted },
  addressCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  addressInput: { flex: 1, fontSize: 15, color: colors.neutral.text, paddingVertical: 8 },
  addressDivider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 4, marginLeft: 22 },
  section: {},
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 10 },
  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: colors.neutral.surface, borderRadius: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.neutral.border,
  },
  vehicleRowActive: { borderColor: colors.secondary.DEFAULT, backgroundColor: '#EEF6FF' },
  vehicleIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  vehicleLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral.text },
  vehicleLabelActive: { color: colors.secondary.DEFAULT },
  vehicleDesc: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  vehiclePrice: { fontSize: 14, fontWeight: '800', color: colors.secondary.DEFAULT },
  vehicleEta: { fontSize: 11, color: colors.neutral.textMuted },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary.DEFAULT, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  successTitle: { fontSize: 26, fontWeight: '800', color: colors.neutral.text, marginTop: 16, marginBottom: 8 },
  successSub: { fontSize: 15, color: colors.neutral.textMuted, marginBottom: 24 },
  driverCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    alignItems: 'center', width: '100%', marginBottom: 24,
  },
  driverName: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  driverMeta: { fontSize: 14, color: colors.neutral.textMuted, marginTop: 4 },
  doneBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
