import React, { useEffect, useMemo, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, ShieldAlert, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useParcelEstimate, useBookParcel } from '@/features/mobility/hooks/useModes';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import {
  PARCEL_CATEGORIES,
  PARCEL_SIZES,
  PARCEL_SPEEDS,
  PROHIBITED_ITEMS,
} from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole, nairaToKobo } from '@/features/mobility/utils/mobilityFormatters';
import type { ParcelCategory, ParcelSize, ParcelSpeed, ParcelEstimate, Place } from '@/features/mobility/types/modes.types';
import { withPlusCode } from '@/lib/addressLookup';

export default function ParcelDescribeScreen() {
  const params = useLocalSearchParams<{
    pickup?: string; dropoff?: string;
    pickupLat?: string; pickupLng?: string;
    dropoffLat?: string; dropoffLng?: string;
    pickupPlus?: string; dropoffPlus?: string;
  }>();
  // Coordinates come from the address-lookup step (proxy/Google with offline
  // fallback, confirmed on map). The fare is distance-based, so these must be the real
  // picked coordinates — the fallbacks only guard a direct deep-link with none.
  // The Plus Code rides inside the address text so the courier receives it.
  const pickup: Place = useMemo(() => ({
    address: withPlusCode(params.pickup ?? '14 Admiralty Way, Lekki Phase 1', params.pickupPlus),
    lat: Number(params.pickupLat) || 6.4459,
    lng: Number(params.pickupLng) || 3.473,
  }), [params.pickup, params.pickupLat, params.pickupLng, params.pickupPlus]);
  const dropoff: Place = useMemo(() => ({
    address: withPlusCode(params.dropoff ?? 'Ikeja City Mall, Alausa', params.dropoffPlus),
    lat: Number(params.dropoffLat) || 6.6186,
    lng: Number(params.dropoffLng) || 3.3585,
  }), [params.dropoff, params.dropoffLat, params.dropoffLng, params.dropoffPlus]);

  const [category, setCategory] = useState<ParcelCategory>('documents');
  const [size, setSize] = useState<ParcelSize>('small');
  const [speed, setSpeed] = useState<ParcelSpeed>('standard');
  const [declaredValue, setDeclaredValue] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [photoAttached, setPhotoAttached] = useState(false);
  const [prohibitedAck, setProhibitedAck] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const estimate = useParcelEstimate();
  const book = useBookParcel();
  const est: ParcelEstimate | undefined = estimate.data;
  // Shared chooser: wallet OR card (Paystack top-up) → then the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();

  const declaredValueKobo = nairaToKobo(Number(declaredValue) || 0);

  // Re-estimate when the priced inputs change. Fare always comes from the server.
  useEffect(() => {
    setSubmitError(null);
    estimate.mutate({ pickup, dropoff, category, size, speed, declaredValueKobo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, size, speed, declaredValue]);

  const canBook =
    !!est &&
    receiverName.trim().length > 1 &&
    receiverPhone.trim().length >= 7 &&
    prohibitedAck &&
    !book.isPending;

  const onBook = () => {
    if (!est) return;
    setSubmitError(null);
    pay.start({
      amountKobo: est.totalKobo,
      title: 'Pay for delivery',
      // Existing wallet booking charge (with its Idempotency-Key) runs unchanged.
      charge: () =>
        book.mutateAsync({
          pickup, dropoff, category, size, speed, declaredValueKobo,
          receiverName: receiverName.trim(),
          receiverPhone: receiverPhone.trim(),
          photoUrl: photoAttached ? 'mock://parcel-photo' : undefined,
          prohibitedAck,
          paymentMethod: 'wallet',
        }),
      onPaid: (parcel) => router.replace(`/mobility/parcel/${parcel.id}`),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Parcel details" />
      {estimate.isError && !est ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => estimate.mutate({ pickup, dropoff, category, size, speed, declaredValueKobo })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <TripRouteCard pickup={pickup} dest={dropoff} />

            <Text style={styles.section}>What are you sending?</Text>
            <View style={styles.grid2}>
              {PARCEL_CATEGORIES.map((c) => (
                <View key={c.value} style={styles.gridHalf}>
                  <SelectableCard title={c.label} icon={c.icon} selected={category === c.value} onPress={() => setCategory(c.value)} />
                </View>
              ))}
            </View>

            <Text style={styles.section}>Size</Text>
            <View style={styles.list}>
              {PARCEL_SIZES.map((s) => (
                <SelectableCard key={s.value} title={s.label} subtitle={s.hint} selected={size === s.value} onPress={() => setSize(s.value)} />
              ))}
            </View>

            <Text style={styles.section}>Delivery speed</Text>
            <View style={styles.list}>
              {PARCEL_SPEEDS.map((s) => (
                <SelectableCard key={s.value} title={s.label} subtitle={s.hint} selected={speed === s.value} onPress={() => setSpeed(s.value)} />
              ))}
            </View>

            <Text style={styles.section}>Receiver</Text>
            <TextInputField label="Receiver name" value={receiverName} onChangeText={setReceiverName} placeholder="Who is receiving it?" />
            <PhoneNumberInput label="Receiver phone" value={receiverPhone} onChange={({ e164, nsn }) => (setReceiverPhone)(e164 || nsn)} />

            <Text style={styles.section}>Declared value (for insurance)</Text>
            <TextInputField value={declaredValue} onChangeText={(t) => setDeclaredValue(sanitizeMoneyInput(t))} placeholder="₦ value of contents" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />

            <Pressable style={[styles.photoBtn, photoAttached && styles.photoBtnDone]} onPress={() => setPhotoAttached((p) => !p)}>
              <Camera size={18} color={photoAttached ? Colors.tertiaryContainer : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.photoLabel, photoAttached && styles.photoLabelDone]}>
                {photoAttached ? 'Photo attached' : 'Add a photo (optional)'}
              </Text>
              {photoAttached && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
            </Pressable>

            {/* Prohibited items acknowledgement (required) */}
            <View style={styles.prohibitedCard}>
              <View style={styles.prohibitedHead}>
                <ShieldAlert size={18} color={Colors.error} strokeWidth={2.2} />
                <Text style={styles.prohibitedTitle}>Prohibited items</Text>
              </View>
              {PROHIBITED_ITEMS.map((item) => (
                <Text key={item} style={styles.prohibitedItem}>• {item}</Text>
              ))}
              <Pressable style={styles.ackRow} onPress={() => setProhibitedAck((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: prohibitedAck }}>
                <View style={[styles.checkbox, prohibitedAck && styles.checkboxOn]}>
                  {prohibitedAck && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
                </View>
                <Text style={styles.ackText}>I confirm this parcel contains none of the prohibited items above.</Text>
              </Pressable>
            </View>

            {est && (
              <FareBreakdownCard
                title="Estimated cost"
                fareKobo={est.totalKobo}
                distanceM={est.distanceM}
                durationS={est.durationS}
                rows={[
                  { label: 'Delivery fee', valueKobo: est.fareKobo },
                  { label: 'Insurance cover', valueKobo: est.insuranceKobo },
                ]}
                showTrustNote
              />
            )}

            {submitError && (
              <View style={styles.errRow}>
                <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
                <Text style={styles.errText}>{submitError}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Total</Text>
              {estimate.isPending && !est ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.fareValue}>{formatNairaWhole(est?.totalKobo ?? 0)}</Text>}
            </View>
            {!prohibitedAck && <Text style={styles.ackHint}>Accept the prohibited-items policy to continue.</Text>}
            <PrimaryButton label="Book courier" onPress={onBook} loading={book.isPending} disabled={!canBook} />
          </View>
        </>
      )}
      {/* Shared wallet/card chooser — drives the booking charge above. */}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridHalf: { width: '48.5%' },
  list: { gap: Spacing.sm },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent, marginTop: Spacing.sm },
  photoBtnDone: { borderColor: Colors.tertiaryContainer, backgroundColor: Colors.tertiaryFixed },
  photoLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  photoLabelDone: { color: Colors.tertiaryContainer },
  prohibitedCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.errorContainer, gap: 4, marginTop: Spacing.sm },
  prohibitedHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  prohibitedTitle: { ...Typography.labelLg, color: Colors.onSurface },
  prohibitedItem: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ackText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  ackHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
