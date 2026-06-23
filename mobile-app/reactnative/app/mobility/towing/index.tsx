import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera, Check, AlertTriangle, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTowingEstimate, useBookTowing } from '@/features/mobility/hooks/useModes';
import {
  TOWING_SERVICES, TOWING_ISSUES, TOWING_VEHICLE_TYPES, TOWING_ENABLED,
} from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole, formatEta, toMobilityError } from '@/features/mobility/utils/mobilityFormatters';
import type { TowingServiceType, TowingIssue, TowingVehicleType, TowingEstimate, Place } from '@/features/mobility/types/modes.types';

const PICKUP: Place = { address: '3rd Mainland Bridge (Lagos-bound)', lat: 6.5, lng: 3.4 };
const DEST: Place = { address: 'AutoWorks Garage, Ikeja', lat: 6.6018, lng: 3.3515 };

export default function TowingHomeScreen() {
  const [serviceType, setServiceType] = useState<TowingServiceType>('flatbed');
  const [issue, setIssue] = useState<TowingIssue>('breakdown');
  const [vehicleType, setVehicleType] = useState<TowingVehicleType>('sedan');
  const [pickup, setPickup] = useState(PICKUP.address);
  const [destAddr, setDestAddr] = useState(DEST.address);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isRoadside = serviceType === 'roadside';
  const estimate = useTowingEstimate();
  const book = useBookTowing();
  const est: TowingEstimate | undefined = estimate.data;

  const pickupPlace: Place = useMemo(() => ({ ...PICKUP, address: pickup }), [pickup]);
  const destPlace: Place | null = useMemo(() => (isRoadside ? null : { ...DEST, address: destAddr }), [isRoadside, destAddr]);

  useEffect(() => {
    setSubmitError(null);
    estimate.mutate({ serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, issue, vehicleType, isRoadside]);

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
    book.mutate(
      { serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType, photoUrl: photoTaken ? 'mock://vehicle' : undefined, paymentMethod: 'wallet' },
      {
        onSuccess: (job) => router.replace(`/mobility/towing/${job.id}`),
        onError: (e) => {
          const me = toMobilityError(e);
          setSubmitError(me.code === 'PAYMENT_FAILED' ? 'Payment could not be authorised. Top up or try another method.' : me.message);
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tow & rescue" />
      {estimate.isError && !est ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => estimate.mutate({ serviceType, issue, pickup: pickupPlace, dest: destPlace, vehicleType })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
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
            <TextInputField value={pickup} onChangeText={setPickup} placeholder="Where are you stranded?" leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />} />
            {!isRoadside && (
              <TextInputField label="Tow destination" value={destAddr} onChangeText={setDestAddr} placeholder="Where should we tow it?" leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  list: { gap: Spacing.sm },
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
