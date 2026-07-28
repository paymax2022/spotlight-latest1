import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Minus, Plus, Check, UserCheck, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import VehicleClassCard from '@/features/mobility/components/VehicleClassCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useCarHireQuote, useBookCarHire } from '@/features/mobility/hooks/useModes';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { HIRE_TYPES, VEHICLE_CLASSES, CARHIRE_ENABLED } from '@/features/mobility/constants/modes.constants';
import { VEHICLE_CLASS_META, VEHICLE_CLASS_GALLERY } from '@/features/mobility/constants/carhireCatalog';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { HireType, VehicleClass, CarHireQuote } from '@/features/mobility/types/modes.types';

export default function CarHireHomeScreen() {
  const [hireType, setHireType] = useState<HireType>('daily');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('executive');
  const [startDate, setStartDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [durationHours, setDurationHours] = useState(8);
  const [chauffeur, setChauffeur] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const quote = useCarHireQuote();
  const book = useBookCarHire();
  const q: CarHireQuote | undefined = quote.data;
  // Shared chooser: wallet OR card (Paystack top-up) → then the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();

  useEffect(() => {
    setSubmitError(null);
    quote.mutate({ hireType, vehicleClass, startAt: new Date(startDate).toISOString(), durationHours, chauffeur });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hireType, vehicleClass, durationHours, chauffeur, startDate]);

  if (!CARHIRE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Car hire" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const onBook = () => {
    if (!q) return;
    setSubmitError(null);
    pay.start({
      amountKobo: q.totalKobo,
      title: 'Pay for car hire',
      // Existing wallet booking charge (with its Idempotency-Key) runs unchanged.
      charge: () =>
        book.mutateAsync({
          hireType, vehicleClass, startAt: new Date(startDate).toISOString(),
          durationHours, chauffeur, paymentMethod: 'wallet',
        }),
      onPaid: (booking) => router.replace(`/mobility/carhire/${booking.id}`),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Car hire" />
      {quote.isError && !q ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => quote.mutate({ hireType, vehicleClass, startAt: new Date(startDate).toISOString(), durationHours, chauffeur })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <Text style={styles.section}>Hire type</Text>
            <View style={styles.grid2}>
              {HIRE_TYPES.map((h) => (
                <View key={h.value} style={styles.gridHalf}>
                  <SelectableCard title={h.label} subtitle={h.hint} icon={h.icon} selected={hireType === h.value} onPress={() => setHireType(h.value)} />
                </View>
              ))}
            </View>

            <Text style={styles.section}>Choose your vehicle</Text>
            <Text style={styles.sectionHint}>Starting rates shown — your final quote appears below.</Text>
            <View style={styles.vehicleList}>
              {VEHICLE_CLASSES.map((v) => (
                <VehicleClassCard
                  key={v.value}
                  label={v.label}
                  meta={VEHICLE_CLASS_META[v.value]}
                  selected={vehicleClass === v.value}
                  onPress={() => setVehicleClass(v.value)}
                  galleryCount={VEHICLE_CLASS_GALLERY[v.value].length}
                  onViewGallery={() => router.push(`/mobility/carhire/gallery?class=${v.value}`)}
                />
              ))}
            </View>

            <Text style={styles.section}>Start date</Text>
            <TextInputField value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />

            <Text style={styles.section}>Duration (hours)</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDurationHours((d) => Math.max(1, d - 1))} disabled={durationHours <= 1}>
                <Minus size={18} color={durationHours <= 1 ? Colors.outline : Colors.primary} strokeWidth={2.4} />
              </Pressable>
              <Text style={styles.stepValue}>{durationHours}h</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDurationHours((d) => Math.min(72, d + 1))}>
                <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
              </Pressable>
            </View>

            {/* Chauffeur option */}
            <Pressable style={[styles.chauffeur, chauffeur && styles.chauffeurOn]} onPress={() => setChauffeur((c) => !c)}>
              <View style={styles.chauffeurIcon}><UserCheck size={18} color={chauffeur ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.chauffeurTitle, chauffeur && styles.chauffeurTitleOn]}>With chauffeur</Text>
                <Text style={styles.chauffeurSub}>A professional driver for your hire</Text>
              </View>
              <View style={[styles.toggle, chauffeur && styles.toggleOn]}>{chauffeur && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
            </Pressable>

            {q && (
              <FareBreakdownCard
                title="Quote"
                fareKobo={q.totalKobo}
                rows={[
                  { label: 'Hire fare', valueKobo: q.fareKobo },
                  ...(q.chauffeurKobo > 0 ? [{ label: 'Chauffeur', valueKobo: q.chauffeurKobo }] : []),
                  { label: 'Refundable deposit', valueKobo: q.depositKobo },
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
              <Text style={styles.fareLabel}>Total (incl. deposit)</Text>
              {quote.isPending && !q ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.fareValue}>{formatNairaWhole(q?.totalKobo ?? 0)}</Text>}
            </View>
            <PrimaryButton label="Book & pay" onPress={onBook} loading={book.isPending} disabled={!q} />
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
  sectionHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -2 },
  vehicleList: { gap: Spacing.md, marginTop: Spacing.xs },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridHalf: { width: '48.5%' },
  list: { gap: Spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.outlineVariant },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const, minWidth: 40, textAlign: 'center' },
  chauffeur: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant, marginTop: Spacing.sm },
  chauffeurOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chauffeurIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  chauffeurTitle: { ...Typography.labelLg, color: Colors.onSurface },
  chauffeurTitleOn: { color: Colors.primary },
  chauffeurSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  toggle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
