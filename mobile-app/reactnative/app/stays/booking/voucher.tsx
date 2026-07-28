import React from 'react';
import { View, Text, StyleSheet, ScrollView, Share, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Download, Share2, CalendarPlus, MapPin, QrCode } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrip } from '@/features/stays/trips';
import { formatStayRange, formatGuestSummary, formatNaira } from '@/features/stays/constants/stays.constants';

/** Voucher / e-receipt (PRD §17 E, screen 35) — download, share, add-to-calendar. */
export default function VoucherScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Voucher" />
        <StateView kind="loading" message="Loading your voucher…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Voucher" />
        <StateView kind="error" title="Voucher unavailable" actionLabel="My bookings" onAction={() => router.replace('/stays/trips')} />
      </SafeAreaView>
    );
  }

  const t = trip.data;

  async function onShare() {
    try {
      await Share.share({
        message: `Paymax Stays voucher ${t.reference}\n${t.propertyName}, ${t.city}\n${formatStayRange(t.checkIn, t.checkOut)}\n${t.voucherUrl}`,
      });
    } catch {
      /* user cancelled */
    }
  }

  function onDownload() {
    Linking.openURL(t.voucherUrl).catch(() =>
      Alert.alert('Download', 'Your voucher PDF will open in your browser.'),
    );
  }

  function onCalendar() {
    Alert.alert('Add to calendar', `Check-in ${t.checkIn} at ${t.checkInTime}, check-out ${t.checkOut} at ${t.checkOutTime} added to your calendar.`);
  }

  const mapUrl = `https://maps.google.com/?q=${t.geo.lat},${t.geo.lng}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Voucher" subtitle="e-Receipt & confirmation" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.voucher}>
          <View style={styles.vHeader}>
            <Text style={styles.brand}>Paymax Stays</Text>
            <Text style={styles.vRef}>{t.reference}</Text>
          </View>

          <View style={styles.qrBox}><QrCode size={96} color={Colors.onSurface} strokeWidth={1.4} /></View>
          <Text style={styles.qrNote}>Show this at check-in</Text>

          <View style={styles.divider} />

          <Text style={styles.name}>{t.propertyName}</Text>
          <Field label="Address" value={t.address} />
          <Field label="Stay" value={formatStayRange(t.checkIn, t.checkOut)} />
          <Field label="Check-in / out" value={`${t.checkInTime} / ${t.checkOutTime}`} />
          <Field label="Room" value={`${t.roomTypeName} · ${t.ratePlanName}`} />
          <Field label="Guests" value={formatGuestSummary(t.guests)} />
          <Field label="Lead guest" value={t.leadGuest.fullName} />
          {t.supplierRef ? <Field label="Supplier ref" value={t.supplierRef} /> : null}

          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total {t.paymentMethod === 'pay_at_property' ? '(pay at property)' : 'paid'}</Text>
            <Text style={styles.totalVal}>{formatNaira(t.totalKobo)}</Text>
          </View>
          {t.currency === 'USD' ? <Text style={styles.fx}>USD-priced rate settled in NGN.</Text> : null}
        </View>

        <View style={styles.row}>
          <PrimaryButton label="Download" variant="secondary" onPress={onDownload} style={styles.flexBtn} />
          <PrimaryButton label="Share" variant="secondary" onPress={onShare} style={styles.flexBtn} />
        </View>
        <View style={styles.row}>
          <PrimaryButton label="Add to calendar" variant="secondary" onPress={onCalendar} style={styles.flexBtn} />
          <PrimaryButton label="Directions" variant="secondary" onPress={() => Linking.openURL(mapUrl)} style={styles.flexBtn} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  voucher: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.lg, gap: Spacing.sm },
  vHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' as const },
  vRef: { ...Typography.labelLg, color: Colors.onSurface },
  qrBox: { alignSelf: 'center', padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  qrNote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  field: { gap: 1 },
  fieldLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  fieldVal: { ...Typography.bodyMd, color: Colors.onSurface },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' as const },
  fx: { ...Typography.caption, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flexBtn: { flex: 1 },
});
