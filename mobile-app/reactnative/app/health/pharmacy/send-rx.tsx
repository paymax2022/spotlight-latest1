import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Stethoscope, Store, MapPin, Star, CalendarPlus, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { usePharmacies, usePrescriptions, useSendPrescriptionToPharmacy } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

/**
 * Send an issued e-prescription to a pharmacy for verification (HL-3:
 * ISSUED → SENT_TO_PHARMACY). This replaced a "photograph your prescription"
 * upload screen that had no backend: no upload route, no storage key and no
 * data-model home for an image, so a photo could never reach a pharmacist.
 * A prescription is issued by a licensed prescriber through a consult — this
 * screen picks one of the patient's own e-Rxs and pins it to a pharmacy.
 */
export default function SendRxScreen() {
  const { rxId: presetRxId } = useLocalSearchParams<{ rxId?: string }>();
  const { data: prescriptions, isLoading: rxLoading, isError: rxError, refetch: refetchRx } = usePrescriptions();
  const { data: pharmacies, isLoading: phLoading, isError: phError, refetch: refetchPh } = usePharmacies({ sort: 'rating' });
  const send = useSendPrescriptionToPharmacy();
  const [selectedRx, setSelectedRx] = useState<string | null>(presetRxId ?? null);
  const [selectedPharmacy, setSelectedPharmacy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only an e-Rx that has not been sent yet can be sent; once a pharmacist has it,
  // its status belongs to them.
  const sendable = useMemo(() => (prescriptions ?? []).filter((r) => r.status === 'issued'), [prescriptions]);

  useEffect(() => {
    if (!selectedRx && sendable.length > 0) setSelectedRx(sendable[0].id);
  }, [sendable, selectedRx]);

  const onSend = async () => {
    if (!selectedRx) {
      setError('Choose the prescription you want to send.');
      return;
    }
    if (!selectedPharmacy) {
      setError('Choose a pharmacy to receive it.');
      return;
    }
    setError(null);
    try {
      const rx = await send.mutateAsync({ rxId: selectedRx, pharmacyProviderId: selectedPharmacy });
      router.replace({ pathname: '/health/pharmacy/rx-status', params: { id: rx.id } });
    } catch {
      setError('The pharmacy could not receive this prescription. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Send my e-Rx" subtitle="To a verified pharmacy" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Step 1 — which prescription */}
        <Text style={styles.stepLabel}>1. Choose a prescription</Text>
        {rxLoading ? (
          <StateView kind="loading" message="Loading your prescriptions…" />
        ) : rxError ? (
          <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetchRx} />
        ) : sendable.length === 0 ? (
          <View style={styles.noRx}>
            <Text style={styles.noRxBody}>
              {prescriptions && prescriptions.length > 0
                ? 'None of your prescriptions is waiting to be sent — the ones you have are already with a pharmacist.'
                : 'E-prescriptions are issued by a licensed doctor at the end of a tele-consult. There is nothing on your account to send yet.'}
            </Text>
            <Pressable style={[styles.bookBtn, shadow1]} onPress={() => router.push('/services/telemedicine/book')}>
              <CalendarPlus size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.bookText}>Book a doctor consult</Text>
            </Pressable>
          </View>
        ) : (
          sendable.map((rx) => {
            const isSel = rx.id === selectedRx;
            return (
              <Pressable
                key={rx.id}
                style={[styles.card, isSel && styles.cardSel]}
                onPress={() => setSelectedRx(rx.id)}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
                    <Stethoscope size={18} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {rx.items.length > 0 ? rx.items.map((i) => i.name).join(', ') : 'Prescription'}
                    </Text>
                    <Text style={styles.cardSub}>Issued {formatDate(rx.uploadedAt)}</Text>
                  </View>
                  <View style={[styles.radio, isSel && styles.radioSel]}>{isSel ? <View style={styles.radioDot} /> : null}</View>
                </View>
              </Pressable>
            );
          })
        )}

        {/* Step 2 — which pharmacy */}
        <Text style={styles.stepLabel}>2. Choose a pharmacy</Text>
        {phLoading ? (
          <StateView kind="loading" message="Finding pharmacies…" />
        ) : phError ? (
          <StateView kind="error" title="Couldn't load pharmacies" message="Please try again." actionLabel="Retry" onAction={refetchPh} />
        ) : (pharmacies ?? []).length === 0 ? (
          <StateView kind="empty" icon="Store" title="No pharmacies yet" message="No verified pharmacy is registered on the platform right now." />
        ) : (
          (pharmacies ?? []).map((p) => {
            const isSel = p.id === selectedPharmacy;
            return (
              <Pressable
                key={p.id}
                style={[styles.card, isSel && styles.cardSel]}
                onPress={() => setSelectedPharmacy(p.id)}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgPurple }]}>
                    <Store size={18} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <Star size={11} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                      <Text style={styles.cardSub}>
                        {p.rating.toFixed(1)} ({p.reviewCount})
                      </Text>
                      {p.distanceKm > 0 ? (
                        <>
                          <Text style={styles.dot}>·</Text>
                          <MapPin size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
                          <Text style={styles.cardSub}>{p.distanceKm} km</Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  <View style={[styles.radio, isSel && styles.radioSel]}>{isSel ? <View style={styles.radioDot} /> : null}</View>
                </View>
              </Pressable>
            );
          })
        )}

        <View style={styles.assure}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.assureText}>
            A licensed pharmacist at the pharmacy verifies it before anything can be dispensed, and it can only be dispensed once.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Send for verification"
          onPress={onSend}
          loading={send.isPending}
          disabled={sendable.length === 0 || !selectedRx || !selectedPharmacy}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  stepLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cardSel: { borderColor: Colors.primary, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurface },
  cardSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dot: { color: Colors.outline },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSel: { borderColor: Colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.primary },
  noRx: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  noRxBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm + 2,
  },
  bookText: { ...Typography.labelMd, color: Colors.secondary },
  assure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  assureText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
