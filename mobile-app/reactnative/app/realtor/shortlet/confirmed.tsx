import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PartyPopper, KeyRound, DoorOpen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import { useShortletBooking } from '@/features/realtor/hooks/useRealtorShortlet';
import { formatSlotDate } from '@/features/realtor/utils/realtorFormatters';
import { useStayGatePass } from '@/features/property/hooks';

export default function ShortletConfirmedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useShortletBooking(String(id));
  // Estate gate pass auto-issued for the stay (null when the property isn't gated).
  const gatePass = useStayGatePass(id ? String(id) : undefined);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <PartyPopper size={44} color={Colors.tertiaryContainer} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Booking confirmed</Text>
        <Text style={styles.subtitle}>Your stay is booked. Check-in details are below and in your bookings.</Text>

        {booking.isLoading ? (
          <StateView kind="loading" compact />
        ) : booking.data ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{booking.data.listingTitle}</Text>
            <Text style={styles.cardDates}>
              {formatSlotDate(booking.data.checkIn)} → {formatSlotDate(booking.data.checkOut)} · {booking.data.nights} night{booking.data.nights > 1 ? 's' : ''}
            </Text>
            <View style={styles.codeRow}>
              <KeyRound size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.codeLabel}>Access code</Text>
              <Text style={styles.code}>{booking.data.accessCode}</Text>
            </View>
          </View>
        ) : null}

        {/* Auto-issued estate gate pass (visitor pass) — shown if the stay is in a gated estate. */}
        {gatePass.data ? (
          <View style={styles.gateCard}>
            <View style={styles.gateHead}>
              <DoorOpen size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.gateTitle}>Estate gate pass</Text>
            </View>
            <Text style={styles.gateSub}>Show this QR (or the PIN) at the gate on arrival.</Text>
            <QrCodeView payload={gatePass.data.qrPayload} size={160} />
            <View style={styles.pinRow}>
              <Text style={styles.pinLabel}>Gate PIN</Text>
              <Text style={styles.pin}>{gatePass.data.pin}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="View booking" onPress={() => router.replace(`/realtor/shortlet/booking/${id}`)} />
        <PrimaryButton label="Back to marketplace" variant="secondary" onPress={() => router.replace('/realtor')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.sm },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardDates: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryFixed, borderRadius: Radius.md, padding: Spacing.md },
  codeLabel: { ...Typography.bodyMd, color: Colors.onPrimaryFixed, flex: 1 },
  code: { ...Typography.headlineMd, color: Colors.primary, letterSpacing: 4 },
  gateCard: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.sm },
  gateHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'flex-start' },
  gateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  gateSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, alignSelf: 'flex-start' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'stretch', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: Spacing.sm },
  pinLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  pin: { ...Typography.titleLg, color: Colors.secondary, letterSpacing: 4 },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
