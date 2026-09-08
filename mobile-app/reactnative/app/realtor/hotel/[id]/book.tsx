import React, { useMemo, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus } from 'lucide-react-native';
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
import { useHotel, useBookHotel } from '@/features/realtor/hooks/useRealtorHotel';
import { formatNaira, formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

const MOCK_WALLET = 3_000_000;
const isoPlus = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

export default function HotelBookScreen() {
  const { id, roomTypeId, ratePlanId } = useLocalSearchParams<{ id: string; roomTypeId: string; ratePlanId: string }>();
  const hotel = useHotel(String(id));
  const book = useBookHotel();
  const [checkInDays, setCheckInDays] = useState(3);
  const [nights, setNights] = useState(2);
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [request, setRequest] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PAYSTACK');
  const [error, setError] = useState<string>();

  const rt = hotel.data?.roomTypes.find((t) => t.id === roomTypeId);
  const rp = rt?.ratePlans.find((p) => p.id === ratePlanId) ?? rt?.ratePlans[0];
  const checkIn = isoPlus(checkInDays);
  const checkOut = isoPlus(checkInDays + nights);
  const total = useMemo(() => (rp?.nightly ?? 0) * nights, [rp, nights]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => i + 1), []);

  const submit = async () => {
    if (name.trim().length < 2 || phone.trim().length < 7) return setError('Enter the guest name and phone.');
    setError(undefined);
    try {
      const res = await book.mutateAsync({ hotelId: String(id), roomTypeId: String(roomTypeId), ratePlanId: String(ratePlanId), checkIn, checkOut, guests, guestName: name.trim(), guestPhone: phone.trim(), specialRequest: request.trim() || undefined });
      router.replace(`/realtor/hotel/confirmed?id=${res.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not complete the booking.');
    }
  };

  if (hotel.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Book room" /><StateView kind="loading" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book room" subtitle={`${rt?.name} · ${rp?.name}`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Check-in date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {days.map((d) => {
            const active = d === checkInDays;
            return <Pressable key={d} onPress={() => setCheckInDays(d)} style={[styles.dayChip, active && styles.dayChipActive]}><Text style={[styles.dayText, active && styles.dayTextActive]}>{formatSlotDate(isoPlus(d))}</Text></Pressable>;
          })}
        </ScrollView>

        <Stepper label="Nights" value={nights} min={1} max={30} onChange={setNights} />
        <Stepper label="Guests" value={guests} min={1} max={rt?.capacity ?? 4} onChange={setGuests} />

        <View style={styles.card}>
          <DetailRow label={`${formatNaira(rp?.nightly ?? 0)} × ${nights} nights`} value={formatNaira(total)} />
          <View style={styles.divider} />
          <DetailRow label="Total" value={formatNaira(total)} emphasis />
        </View>

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Guest details</Text>
        <TextInputField label="Lead guest name" placeholder="Full name" value={name} onChangeText={setName} />
        <PhoneNumberInput label="Phone" value={phone} onChange={({ e164, nsn }) => (setPhone)(e164 || nsn)} />
        <TextInputField label="Special request (optional)" placeholder="e.g. high floor, late check-in" value={request} onChangeText={setRequest} multiline />

        <View style={{ marginTop: Spacing.sm }}>
          <PaymentMethodSelector selected={method} onSelect={setMethod} walletBalance={MOCK_WALLET} amount={total / 100} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={`Pay ${formatNaira(total)}`} onPress={submit} loading={book.isPending} disabled={!rp} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - 1))} accessibilityLabel={`Decrease ${label}`}><Minus size={16} color={Colors.primary} strokeWidth={2.4} /></Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + 1))} accessibilityLabel={`Increase ${label}`}><Plus size={16} color={Colors.primary} strokeWidth={2.4} /></Pressable>
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
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.md },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
});
