import React, { useEffect, useMemo, useRef, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useParcelEstimate, useBookParcel } from '@/features/mobility/hooks/useModes';
import { expectedFareFor } from '@/features/mobility/utils/parcelFareDrift';
import {
  bookingInsuranceFields,
  parcelBookingErrorFrom,
  parcelInsuranceSelection,
  type ParcelBookingError,
} from '@/features/mobility/utils/parcelInsurance';
import { nextBookingKey, type BookingKey } from '@/features/mobility/utils/parcelBookingKey';
import { usePurchasePayment, useGatewayCheckout, PaymentSheet } from '@/features/payments';
import * as parcelAPI from '@/features/mobility/api/parcel.api';
import { parcelCardDirectResolverRoute } from '@/features/mobility/utils/cardDirect';
import {
  PARCEL_CATEGORIES,
  PARCEL_SIZES,
  PARCEL_SPEEDS,
  PROHIBITED_ITEMS,
} from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole, nairaToKobo, newIdempotencyKey } from '@/features/mobility/utils/mobilityFormatters';
import type { ParcelCategory, ParcelSize, ParcelSpeed, ParcelEstimate, Place } from '@/features/mobility/types/modes.types';
import { withPlusCode } from '@/lib/addressLookup';
import { parcelOptionFare, parcelInsuranceLine } from '@/features/mobility/utils/parcelPricing';

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
  // Opt-in cover, paid now with the fare (ADR-PR836). Unticked = fare only.
  const [insure, setInsure] = useState(false);
  // An insurance refusal the sender has to act on here (profile, item value,
  // card rail…), shown in the cover card since the pay sheet can't link out.
  const [insuranceIssue, setInsuranceIssue] = useState<ParcelBookingError | null>(null);

  const estimate = useParcelEstimate();
  const book = useBookParcel();
  const bookingKey = React.useRef<BookingKey | null>(null);
  // Keep the last estimate on screen while a re-estimate is in flight, so the
  // option prices do not blank out on every tap. Booking still waits for the
  // fresh one (canBook below).
  const lastEst = useRef<ParcelEstimate | undefined>(undefined);
  if (estimate.data) lastEst.current = estimate.data;
  const est: ParcelEstimate | undefined = estimate.data ?? lastEst.current;
  const optionPrice = (s: ParcelSize, sp: ParcelSpeed) => {
    const k = parcelOptionFare(est, s, sp);
    return k === undefined ? undefined : formatNairaWhole(k);
  };
  const insuranceLine = parcelInsuranceLine(est?.insurance);
  const cover = parcelInsuranceSelection(est, insure);
  // Shared chooser: wallet OR card (Paystack top-up) → then the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();
  // Card runs through the genuinely separate, server-initiated Paystack rail
  // (transport/paystackcheckout, parcel domain) — NOT usePurchasePayment's
  // built-in wallet-top-up-then-spend card rail, which is blocked for Tier-0
  // senders ("Verification needed"). No wallet debit ever occurs on this rail,
  // so it works without KYC; the server quotes + verifies the amount. The
  // wallet rail above keeps its KYC gate unchanged.
  const paystackCheckout = useGatewayCheckout();
  useEffect(() => {
    if (paystackCheckout.error) setSubmitError(paystackCheckout.error);
  }, [paystackCheckout.error]);

  const declaredValueKobo = nairaToKobo(Number(declaredValue) || 0);

  // Re-estimate when the priced inputs change. Fare always comes from the server.
  useEffect(() => {
    setSubmitError(null);
    setInsuranceIssue(null);
    estimate.mutate({ pickup, dropoff, category, size, speed, declaredValueKobo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, size, speed, declaredValue]);

  const canBook =
    !!estimate.data &&
    !estimate.isPending &&
    receiverName.trim().length > 1 &&
    receiverPhone.trim().length >= 7 &&
    prohibitedAck &&
    !cover.needsDeclaredValue &&
    !book.isPending;

  // Shared by the wallet charge and the card checkout: explain the refusal,
  // and undo whatever made it (a spent key, a stale price).
  const bookingRefusal = (e: unknown): Error | null => {
    const r = parcelBookingErrorFrom(e);
    if (!r) return null;
    if (r.kind === 'key_conflict') bookingKey.current = null;
    if (r.kind === 'fare_changed') estimate.mutate({ pickup, dropoff, category, size, speed, declaredValueKobo });
    if (r.kind === 'profile_incomplete' || r.kind === 'declared_value_required' || r.kind === 'card_not_supported' || r.kind === 'insurance_unavailable') {
      setInsuranceIssue(r);
    }
    return new Error(r.message);
  };

  const onBook = () => {
    if (!est) return;
    setSubmitError(null);
    setInsuranceIssue(null);
    pay.start({
      // What the wallet is debited: the fare, plus the premium when insured.
      amountKobo: cover.payableKobo,
      title: 'Pay for delivery',
      domain: 'parcel',
      // Wallet booking charge (with its Idempotency-Key). It pins the fare and
      // premium the customer saw: if either moved, the server refuses with
      // FARE_CHANGED before charging, and we re-quote so the new price shows.
      charge: async () => {
        const booking = {
          pickup, dropoff, category, size, speed, declaredValueKobo,
          receiverName: receiverName.trim(),
          receiverPhone: receiverPhone.trim(),
          // The toggle uploads nothing yet: only mock builds send a placeholder, so
          // a live booking never stores a fake photo URL.
          photoUrl: photoAttached && parcelAPI.USE_MOCK ? 'mock://parcel-photo' : undefined,
          prohibitedAck,
          paymentMethod: 'wallet' as const,
          ...bookingInsuranceFields(cover),
        };
        // Same booking → same key, so a retry after a lost response returns the
        // first parcel instead of booking (and debiting) again.
        bookingKey.current = nextBookingKey(bookingKey.current, booking, () => newIdempotencyKey('parcel'));
        try {
          return await book.mutateAsync({
            ...booking,
            idempotencyKey: bookingKey.current.key,
            expectedFareKobo: expectedFareFor(est),
            routeToken: est?.routeToken,
          });
        } catch (e) {
          throw bookingRefusal(e) ?? e;
        }
      },
      onPaid: (parcel) => router.replace(`/mobility/parcel/${parcel.id}`),
      // Card → server-initiated Paystack checkout (same shape as estimate.tsx).
      onCard: async () => {
        await paystackCheckout.start({
          domain: 'parcel',
          initialize: async ({ email }) => {
            let r: Awaited<ReturnType<typeof parcelAPI.initiateParcelPaystack>>;
            try {
              r = await parcelAPI.initiateParcelPaystack({
                email, // typed at checkout after the server answered email_required; else the registered email is used
                pickup, dropoff, category, size, speed, declaredValueKobo,
                receiverName: receiverName.trim(),
                receiverPhone: receiverPhone.trim(),
                prohibitedAck,
                // Card can't carry the premium yet: the server refuses (422).
                insure: cover.insured,
                idempotencyKey: newIdempotencyKey('parcel-paystack'),
              });
            } catch (e) {
              throw bookingRefusal(e) ?? e;
            }
            if (!r.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
            return { authorizationUrl: r.authorizationUrl, reference: r.reference };
          },
          onResolved: (res) => {
            router.replace(parcelCardDirectResolverRoute(res.reference) as never);
          },
        });
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Parcel details" />
      {estimate.isError && !est ? (
        <MobilityEdgeState kind={errKind(estimate.error)} actionLabel="Retry" onAction={() => estimate.mutate({ pickup, dropoff, category, size, speed, declaredValueKobo })} />
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
                <SelectableCard key={s.value} title={s.label} subtitle={s.hint} trailing={optionPrice(s.value, speed)} selected={size === s.value} onPress={() => setSize(s.value)} />
              ))}
            </View>

            <Text style={styles.section}>Delivery speed</Text>
            <View style={styles.list}>
              {PARCEL_SPEEDS.map((s) => (
                <SelectableCard key={s.value} title={s.label} subtitle={s.hint} trailing={optionPrice(size, s.value)} selected={speed === s.value} onPress={() => setSpeed(s.value)} />
              ))}
            </View>

            <Text style={styles.section}>Receiver</Text>
            <TextInputField label="Receiver name" value={receiverName} onChangeText={setReceiverName} placeholder="Who is receiving it?" />
            <PhoneNumberInput label="Receiver phone" value={receiverPhone} onChange={({ e164, nsn }) => (setReceiverPhone)(e164 || nsn)} />

            <Text style={styles.section}>Declared value (for insurance)</Text>
            <TextInputField value={declaredValue} onChangeText={(t) => setDeclaredValue(sanitizeMoneyInput(t))} placeholder="₦ value of contents" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
            {insuranceLine && (
              <View style={styles.coverCard}>
                <ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coverTitle}>{insuranceLine}</Text>
                  <Text style={styles.coverNote}>
                    {(est?.insuranceKobo ?? 0) > 0
                      ? 'Covers loss, fire and theft in transit. Paid now with the delivery fee; if cover can\'t be arranged, the premium goes back to your wallet.'
                      : `Enter the value of the contents to insure them against loss, fire and theft in transit${est?.insurance?.minPremiumKobo ? ` (minimum premium ${formatNairaWhole(est.insurance.minPremiumKobo)})` : ''}.`}
                  </Text>
                  <Pressable
                    style={styles.ackRow}
                    onPress={() => { setInsure((v) => !v); setInsuranceIssue(null); setSubmitError(null); }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: insure }}
                    accessibilityLabel="Insure this parcel"
                  >
                    <View style={[styles.checkbox, insure && styles.checkboxOn]}>
                      {insure && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
                    </View>
                    <Text style={styles.ackText}>Insure this parcel</Text>
                    {(est?.insuranceKobo ?? 0) > 0 && <Text style={styles.coverPremium}>+{formatNairaWhole(est?.insuranceKobo ?? 0)}</Text>}
                  </Pressable>
                  {cover.needsDeclaredValue && (
                    <Text style={styles.coverHint}>Enter the item's value above to insure it.</Text>
                  )}
                  {insuranceIssue && (
                    <View style={styles.coverIssue}>
                      <Text style={styles.coverIssueText}>{insuranceIssue.message}</Text>
                      {insuranceIssue.kind === 'profile_incomplete' && (
                        <Pressable onPress={() => router.push('/(tabs)/profile' as never)} accessibilityRole="link" hitSlop={8}>
                          <Text style={styles.coverLink}>Complete your profile</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Upload isn't built yet: shown in mock builds only, so a live booking
                never claims a photo was attached. */}
            {parcelAPI.USE_MOCK && (
              <Pressable style={[styles.photoBtn, photoAttached && styles.photoBtnDone]} onPress={() => setPhotoAttached((p) => !p)}>
                <Camera size={18} color={photoAttached ? Colors.tertiaryContainer : Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={[styles.photoLabel, photoAttached && styles.photoLabelDone]}>
                  {photoAttached ? 'Photo attached' : 'Add a photo (optional)'}
                </Text>
                {photoAttached && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
              </Pressable>
            )}

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
                fareKobo={cover.payableKobo}
                distanceM={est.distanceM}
                durationS={est.durationS}
                rows={[
                  { label: 'Delivery fee', valueKobo: est.fareKobo },
                  ...(cover.insured ? [{ label: 'Insurance cover', valueKobo: cover.premiumKobo }] : []),
                ]}
                showTrustNote
              />
            )}

            {/* An insurance refusal already shows in the cover card above. */}
            {submitError && submitError !== insuranceIssue?.message && (
              <View style={styles.errRow}>
                <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
                <Text style={styles.errText}>{submitError}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Total</Text>
              {estimate.isPending && !est ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.fareValue}>{formatNairaWhole(cover.payableKobo)}</Text>}
            </View>
            {!prohibitedAck && <Text style={styles.ackHint}>Accept the prohibited-items policy to continue.</Text>}
            {prohibitedAck && cover.needsDeclaredValue && <Text style={styles.ackHint}>Enter the item's value to insure it, or untick insurance.</Text>}
            <PrimaryButton label="Book courier" onPress={onBook} loading={book.isPending} disabled={!canBook} />
          </View>
        </>
      )}
      {/* Shared wallet/card chooser — drives the booking charge above. */}
      <PaymentSheet controller={pay} />
      {/* Hosts the in-app Paystack checkout for the card-direct rail. */}
      <paystackCheckout.Sheet />
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
  coverCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.tertiaryFixed, marginTop: Spacing.sm },
  coverTitle: { ...Typography.labelMd, color: Colors.onSurface },
  coverNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 18 },
  coverPremium: { ...Typography.labelMd, color: Colors.onSurface },
  coverHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  coverIssue: { marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.errorContainer, gap: Spacing.xs },
  coverIssueText: { ...Typography.labelSm, color: Colors.error, lineHeight: 18 },
  coverLink: { ...Typography.labelMd, color: Colors.primary },
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
