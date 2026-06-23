import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { BedDouble, Ticket } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useReservation } from '@/features/realtor/hooks/useRealtorHotel';
import { formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

export default function HotelConfirmedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const res = useReservation(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}><BedDouble size={42} color={Colors.tertiaryContainer} strokeWidth={1.8} /></View>
        <Text style={styles.title}>Reservation confirmed</Text>
        <Text style={styles.subtitle}>Show your confirmation code at the front desk to check in.</Text>
        {res.isLoading ? <StateView kind="loading" compact /> : res.data ? (
          <View style={styles.card}>
            <Text style={styles.hotel} numberOfLines={2}>{res.data.hotelName}</Text>
            <Text style={styles.dates}>{formatSlotDate(res.data.checkIn)} → {formatSlotDate(res.data.checkOut)} · {res.data.roomTypeName}</Text>
            <View style={styles.codeRow}>
              <Ticket size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.codeLabel}>Confirmation</Text>
              <Text style={styles.code}>{res.data.confirmationCode}</Text>
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="View reservation" onPress={() => router.replace(`/realtor/hotel/reservation/${id}`)} />
        <PrimaryButton label="Back to hotels" variant="secondary" onPress={() => router.replace('/realtor/hotel')} />
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
  hotel: { ...Typography.labelLg, color: Colors.onSurface },
  dates: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryFixed, borderRadius: Radius.md, padding: Spacing.md },
  codeLabel: { ...Typography.bodyMd, color: Colors.onPrimaryFixed, flex: 1 },
  code: { ...Typography.titleLg, color: Colors.primary, letterSpacing: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
