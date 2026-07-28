import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyRound, DoorOpen, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import DetailRow from '@/features/realtor/components/DetailRow';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useShortletBooking } from '@/features/realtor/hooks/useRealtorShortlet';
import { formatNaira, formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'error' }> = {
  pending_payment: { label: 'Pending payment', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  checked_in: { label: 'Checked in', tone: 'info' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'error' },
};

export default function ShortletBookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useShortletBooking(String(id));

  if (booking.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (!booking.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking" />
        <StateView kind="error" title="Booking not found" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const b = booking.data;
  const meta = STATUS_LABEL[b.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your booking" rightSlot={<StatusBadge label={meta.label} tone={meta.tone} />} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Image source={{ uri: b.coverUrl }} style={styles.cover} />
        <Text style={styles.title}>{b.listingTitle}</Text>
        <Text style={styles.sub}>{b.area}, {b.city}</Text>

        <View style={styles.card}>
          <DetailRow label="Check-in" value={formatSlotDate(b.checkIn)} />
          <DetailRow label="Check-out" value={formatSlotDate(b.checkOut)} />
          <DetailRow label="Nights" value={String(b.nights)} />
          <DetailRow label="Guests" value={String(b.guests)} />
          <View style={styles.divider} />
          <DetailRow label="Total paid" value={formatNaira(b.total)} emphasis />
        </View>

        <View style={styles.accessCard}>
          <View style={styles.accessRow}>
            <KeyRound size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.accessLabel}>Access code</Text>
            <Text style={styles.code}>{b.accessCode}</Text>
          </View>
          <View style={styles.instructionsRow}>
            <DoorOpen size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.instructions}>{b.checkInInstructions}</Text>
          </View>
        </View>

        <View style={styles.escrowNote}>
          <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
          <Text style={styles.escrowText}>{formatNaira(b.securityDeposit)} security deposit held in escrow — released after a clean checkout.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  cover: { width: '100%', height: 180, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh },
  title: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  accessCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.md },
  accessRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryFixed, borderRadius: Radius.md, padding: Spacing.md },
  accessLabel: { ...Typography.bodyMd, color: Colors.onPrimaryFixed, flex: 1 },
  code: { ...Typography.headlineMd, color: Colors.primary, letterSpacing: 4 },
  instructionsRow: { flexDirection: 'row', gap: Spacing.sm },
  instructions: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 20 },
  escrowNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  escrowText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
});
