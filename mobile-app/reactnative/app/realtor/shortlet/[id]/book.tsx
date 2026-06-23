import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import PaymentMethodSelector, { PaymentMethod } from '@/components/PaymentMethodSelector';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useShortletQuote, useCreateShortletBooking } from '@/features/realtor/hooks/useRealtorShortlet';
import { useListing } from '@/features/realtor/hooks/useRealtor';
import { formatNaira, formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

const MOCK_WALLET_NAIRA = 2_000_000;

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ShortletBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(String(id));
  const [checkInDays, setCheckInDays] = useState(2);
  const [nights, setNights] = useState(2);
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PAYSTACK');
  const [error, setError] = useState<string>();

  const checkIn = isoPlus(checkInDays);
  const checkOut = isoPlus(checkInDays + nights);
  const quote = useShortletQuote(String(id), checkIn, checkOut, guests);
  const book = useCreateShortletBooking();

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => i + 1), []);

  const submit = async () => {
    if (name.trim().length < 2 || phone.trim().length < 7) { setError('Enter the guest name and phone.'); return; }
    setError(undefined);
    try {
      const b = await book.mutateAsync({ listingId: String(id), checkIn, checkOut, guests, guestName: name.trim(), guestPhone: phone.trim() });
      router.replace(`/realtor/shortlet/confirmed?id=${b.id}`);
    } catch {
      setError('Could not complete the booking. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book your stay" subtitle={listing.data?.area} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Check-in date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {days.map((d) => {
            const active = d === checkInDays;
            return (
              <Pressable key={d} onPress={() => setCheckInDays(d)} style={[styles.dayChip, active && styles.dayChipActive]}>
                <Text style={[styles.dayText, active && styles.dayTextActive]}>{formatSlotDate(isoPlus(d))}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Stepper label="Nights" value={nights} min={1} max={30} onChange={setNights} />
        <Stepper label="Guests" value={guests} min={1} max={10} onChange={setGuests} />

        <View style={styles.datesSummary}>
          <Text style={styles.datesText}>{formatSlotDate(checkIn)} → {formatSlotDate(checkOut)} · {nights} night{nights > 1 ? 's' : ''}</Text>
        </View>

        {quote.isLoading ? (
          <StateView kind="loading" compact />
        ) : quote.data ? (
          <View style={styles.card}>
            <DetailRow label={`${formatNaira(quote.data.nightly)} × ${quote.data.nights} nights`} value={formatNaira(quote.data.subtotal)} />
            <DetailRow label="Cleaning fee" value={formatNaira(quote.data.cleaningFee)} />
            <DetailRow label="Security deposit" value={formatNaira(quote.data.securityDeposit)} refundable />
            <View style={styles.divider} />
            <DetailRow label="Total" value={formatNaira(quote.data.total)} emphasis />
          </View>
        ) : null}

        <View style={styles.escrowNote}>
          <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
          <Text style={styles.escrowText}>Your security deposit is held in escrow and released after checkout, less any damages.</Text>
        </View>

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Guest details</Text>
        <TextInputField label="Lead guest name" placeholder="Full name" value={name} onChangeText={setName} />
        <TextInputField label="Phone number" placeholder="080..." keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

        <View style={{ marginTop: Spacing.sm }}>
          <PaymentMethodSelector selected={method} onSelect={setMethod} walletBalance={MOCK_WALLET_NAIRA} amount={(quote.data?.total ?? 0) / 100} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={quote.data ? `Pay ${formatNaira(quote.data.total)}` : 'Book now'}
          onPress={submit}
          loading={book.isPending}
          disabled={!quote.data}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - 1))} accessibilityLabel={`Decrease ${label}`}>
          <Minus size={16} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + 1))} accessibilityLabel={`Increase ${label}`}>
          <Plus size={16} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  dayRow: { gap: Spacing.sm, paddingVertical: 2, marginBottom: Spacing.md },
  dayChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  dayChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  dayTextActive: { color: Colors.onPrimary },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  stepperLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 24, textAlign: 'center' },
  datesSummary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginVertical: Spacing.md },
  datesText: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  escrowNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  escrowText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
});
