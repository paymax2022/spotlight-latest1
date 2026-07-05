import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { User, Armchair } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusSeatMap, useBookBus } from '@/features/mobility/hooks/useModes';
import { newIdempotencyKey, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function BusReviewScreen() {
  const { scheduleId, seat, name, phone } = useLocalSearchParams<{ scheduleId: string; seat: string; name: string; phone: string }>();
  const seatMap = useBusSeatMap(scheduleId);
  const book = useBookBus();
  // Shared chooser replaces the in-screen wallet/card picker: pay from wallet OR
  // top up the exact fare via card (Paystack) then run the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();

  const fareKobo = seatMap.data?.fareKobo ?? 0;

  const onPay = () => {
    if (!scheduleId) return;
    pay.start({
      amountKobo: fareKobo,
      title: 'Pay & issue ticket',
      // Existing wallet booking charge (with its Idempotency-Key) runs unchanged.
      charge: () =>
        book.mutateAsync({
          scheduleId,
          seatNumber: String(seat),
          passengerName: String(name),
          passengerPhone: String(phone),
          idempotencyKey: newIdempotencyKey('bus'),
        }),
      onPaid: (ticket) => router.replace(`/mobility/bus/ticket/${ticket.id}`),
    });
  };

  if (seatMap.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <StateView kind="loading" message="Loading fare…" />
      </SafeAreaView>
    );
  }
  if (seatMap.isError || !seatMap.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => seatMap.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review booking" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Row icon={<User size={18} color={Colors.secondary} strokeWidth={2} />} label="Passenger" value={String(name)} />
          <Row icon={<Armchair size={18} color={Colors.secondary} strokeWidth={2} />} label="Seat" value={`Seat ${seat}`} />
        </View>

        <FareBreakdownCard title="Fare" fareKobo={fareKobo} rows={[{ label: 'Bus ticket', valueKobo: fareKobo }]} showTrustNote />
        <Text style={styles.payNote}>Choose how to pay — wallet or card — at the next step.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Total</Text>
          <Text style={styles.fareValue}>{formatNairaWhole(fareKobo)}</Text>
        </View>
        <PrimaryButton label="Pay & issue ticket" onPress={onPay} loading={book.isPending} />
      </View>

      {/* Shared wallet/card chooser — drives the booking charge above. */}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const, flexShrink: 1 },
  section: { ...Typography.labelLg, color: Colors.onSurface },
  payNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  payOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  payLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  payLabelActive: { color: Colors.primary, fontWeight: '600' as const },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
