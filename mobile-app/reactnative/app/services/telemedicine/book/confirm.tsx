import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Wallet as WalletIcon, Video, Phone, MessageCircle } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getDoctor, bookAppointment, formatKobo, DEMO_DOCTORS } from '@/api/telemedicine.api';
import { getWallet } from '@/api/wallet.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { TeleHeader } from '@/features/telemedicine/components';
import type { ConsultType } from '@/types/telemedicine';
import PrimaryButton from '@/components/PrimaryButton';

const SERVICE_FEE_KOBO = 0; // platform booking fee (demo: free)

const TYPE_META: Record<ConsultType, { label: string; Icon: typeof Video }> = {
  video: { label: 'Video consultation', Icon: Video },
  audio: { label: 'Audio consultation', Icon: Phone },
  chat:  { label: 'Chat consultation',  Icon: MessageCircle },
};

export default function ConfirmBookingScreen() {
  const qc = useQueryClient();
  const params = useLocalSearchParams<{
    doctorId: string; slotId: string; slotDate: string; slotTime: string; consultType: ConsultType; reason: string;
  }>();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const idemKeyRef = useRef('');
  const inFlightRef = useRef(false);

  const { data: doctor } = useQuery({
    queryKey: ['tele-doctor', params.doctorId],
    queryFn:  () => getDoctor(String(params.doctorId)),
    placeholderData: DEMO_DOCTORS.find((d) => d.id === params.doctorId),
  });

  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: getWallet });

  const feeKobo = doctor?.feeKobo ?? 0;
  const totalKobo = feeKobo + SERVICE_FEE_KOBO;
  const balanceKobo = Math.round((wallet?.balance ?? 0) * 100);
  const insufficient = balanceKobo < totalKobo;

  const { mutate, isPending, error } = useMutation({
    mutationFn: bookAppointment,
    onSuccess: (result) => {
      inFlightRef.current = false;
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['tele-appointments'] });
      router.replace({
        pathname: '/services/telemedicine/book/success',
        params: {
          ref: result.ref,
          appointmentId: result.appointmentId,
          doctorName: doctor?.name ?? 'your doctor',
          slotDate: params.slotDate,
          slotTime: params.slotTime,
          consultType: params.consultType,
        },
      });
    },
    onError: () => { inFlightRef.current = false; },
  });

  const onConfirm = () => {
    if (!doctor || inFlightRef.current || isPending) return;
    if (insufficient) { setPinError('Top up your wallet to complete this booking.'); return; }
    if (!/^\d{4}$/.test(pin)) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError('');
    inFlightRef.current = true;
    idemKeyRef.current = generateIdempotencyKey();
    mutate({
      doctorId: doctor.id,
      slotId: String(params.slotId),
      consultType: params.consultType,
      reason: String(params.reason ?? ''),
      feeKobo,
      idempotencyKey: idemKeyRef.current,
    });
  };

  const TypeIcon = TYPE_META[params.consultType ?? 'video'].Icon;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Confirm & Pay" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.card, shadow1]}>
          <Text style={styles.cardTitle}>Appointment</Text>
          <View style={styles.divider} />
          <Row label="Doctor" value={doctor?.name ?? '—'} />
          <Row label="Specialty" value={doctor?.specialties.join(', ') ?? '—'} />
          <View style={styles.typeRow}>
            <Text style={styles.rowLabel}>Type</Text>
            <View style={styles.typeBadge}>
              <TypeIcon size={14} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.typeText}>{TYPE_META[params.consultType ?? 'video'].label}</Text>
            </View>
          </View>
          <Row label="Date" value={formatDate(params.slotDate)} />
          <Row label="Time" value={String(params.slotTime ?? '—')} />
        </View>

        <View style={[styles.card, shadow1]}>
          <Text style={styles.cardTitle}>Payment</Text>
          <View style={styles.divider} />
          <Row label="Consultation fee" value={formatKobo(feeKobo)} />
          <Row label="Service fee" value={formatKobo(SERVICE_FEE_KOBO)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatKobo(totalKobo)} highlight />

          <View style={styles.walletRow}>
            <View style={styles.walletLeft}>
              <View style={styles.walletIcon}><WalletIcon size={18} color={Colors.primary} strokeWidth={2} /></View>
              <View>
                <Text style={styles.walletLabel}>Paymax Wallet</Text>
                <Text style={styles.walletBalance}>Balance: {formatKobo(balanceKobo)}</Text>
              </View>
            </View>
            {insufficient && <Text style={styles.lowBadge}>Low</Text>}
          </View>
        </View>

        <View style={[styles.card, shadow1]}>
          <View style={styles.secureHead}>
            <ShieldCheck size={16} color={Colors.teal} strokeWidth={2.2} />
            <Text style={styles.secureText}>Enter your transaction PIN to authorise</Text>
          </View>
          <TextInput
            style={[styles.pinInput, pinError ? styles.pinError : null]}
            placeholder="••••"
            placeholderTextColor={Colors.outline}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            value={pin}
            onChangeText={(t) => { setPin(t.replace(/[^0-9]/g, '')); setPinError(''); }}
          />
          {pinError ? <Text style={styles.errorText}>{pinError}</Text> : null}
          {error ? <Text style={styles.errorText}>{getErrorMessage(error)}</Text> : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay ${formatKobo(totalKobo)}`}
          onPress={onConfirm}
          loading={isPending}
          disabled={insufficient}
        />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && { color: Colors.primary, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 120, gap: Spacing.md },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  divider:     { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs, gap: Spacing.md },
  rowLabel:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:    { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs },
  typeBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  typeText:    { ...Typography.labelSm, color: Colors.secondary },
  walletRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow },
  walletLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  walletIcon:  { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  walletLabel: { ...Typography.labelMd, color: Colors.onSurface },
  walletBalance:{ ...Typography.caption, color: Colors.onSurfaceVariant },
  lowBadge:    { ...Typography.labelSm, color: Colors.error, backgroundColor: Colors.errorContainer, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, overflow: 'hidden' },
  secureHead:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  secureText:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  pinInput:    { height: 56, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, textAlign: 'center', letterSpacing: 12, ...Typography.headlineMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  pinError:    { borderColor: Colors.error },
  errorText:   { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
