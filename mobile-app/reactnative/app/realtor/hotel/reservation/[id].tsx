import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import DetailRow from '@/features/realtor/components/DetailRow';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useReservation } from '@/features/realtor/hooks/useRealtorHotel';
import { formatNaira, formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

const STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'error' }> = {
  pending_payment: { label: 'Pending payment', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  checked_in: { label: 'Checked in', tone: 'info' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'error' },
  no_show: { label: 'No-show', tone: 'error' },
};

export default function HotelReservationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const res = useReservation(String(id));

  if (res.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Reservation" /><StateView kind="loading" /></SafeAreaView>;
  if (!res.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Reservation" /><StateView kind="error" title="Not found" actionLabel="Back" onAction={() => router.back()} /></SafeAreaView>;
  const r = res.data;
  const meta = STATUS[r.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your reservation" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.hotel}>{r.hotelName}</Text>
        <Text style={styles.room}>{r.roomTypeName} · {r.ratePlanName}</Text>

        {/* Check-in QR (rendered as a stylised placeholder block) */}
        <View style={styles.qrCard}>
          <View style={styles.qrBox}><QrCode size={96} color={Colors.onSurface} strokeWidth={1.2} /></View>
          <Text style={styles.qrLabel}>Show at front desk · {r.confirmationCode}</Text>
        </View>

        <View style={styles.card}>
          <DetailRow label="Check-in" value={formatSlotDate(r.checkIn)} />
          <DetailRow label="Check-out" value={formatSlotDate(r.checkOut)} />
          <DetailRow label="Nights" value={String(r.nights)} />
          <DetailRow label="Guests" value={String(r.guests)} />
          {r.roomNumber ? <DetailRow label="Room" value={r.roomNumber} /> : null}
          <View style={styles.divider} />
          <DetailRow label="Total paid" value={formatNaira(r.total)} emphasis />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  hotel: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  room: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  qrCard: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.lg },
  qrBox: { width: 160, height: 160, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  qrLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, marginTop: Spacing.md },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
});
