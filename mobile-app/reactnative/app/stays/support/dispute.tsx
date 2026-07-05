import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Zap, CircleCheckBig, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrip } from '@/features/stays/trips';
import { formatStayRange, formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

const REASONS = [
  'Hotel has no record of my booking',
  'Hotel refused to honour my reservation',
  'Room not as booked',
  'Overcharged at the property',
];

/**
 * Dispute / "hotel has no record" fast-path (PRD §17 F, screen 47 + §22).
 * The confirmation guarantee: money was held-not-charged until the supplier
 * confirmed, so a paid-but-unconfirmed booking is structurally impossible — and
 * if a hotel disputes, this fast-path resolves it and protects the guest's money.
 */
export default function DisputeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');
  const [reason, setReason] = useState(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [filed, setFiled] = useState(false);

  function file() {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setFiled(true);
    }, 1000);
  }

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Dispute" />
        <StateView kind="loading" message="Loading your booking…" />
      </SafeAreaView>
    );
  }

  if (filed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Dispute filed" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheckBig size={48} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Fast-path activated</Text>
          <Text style={styles.successMsg}>
            We've opened a priority case. Because your payment was held until the hotel confirmed, your money is protected. Our team will contact the property and resolve this — with a full refund to your wallet if it can't be honoured.
          </Text>
          <View style={styles.guaranteeRow}>
            <ShieldCheck size={16} color={StaysColors.ok} />
            <Text style={styles.guaranteeText}>Confirmation guarantee: you are never charged for an unconfirmed stay.</Text>
          </View>
          <View style={styles.successActions}>
            <PrimaryButton label="Track in notifications" onPress={() => router.replace('/stays/support/notifications')} />
            <PrimaryButton label="Done" variant="secondary" onPress={() => router.replace('/stays/trips')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Dispute fast-path" subtitle="Confirmation guarantee" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <Zap size={22} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>"Hotel has no record"? We've got you.</Text>
            <Text style={styles.bannerSub}>Paymax guarantees confirmed inventory. Your money was held — not charged — until the hotel confirmed, so you're protected.</Text>
          </View>
        </View>

        {trip.data ? (
          <View style={styles.bookingCard}>
            <Text style={styles.name}>{trip.data.propertyName}</Text>
            <Text style={styles.line}>{trip.data.reference} · {formatStayRange(trip.data.checkIn, trip.data.checkOut)}</Text>
            {trip.data.supplierRef ? <Text style={styles.line}>Supplier ref: {trip.data.supplierRef}</Text> : null}
            <Text style={styles.line}>Paid: {formatNaira(trip.data.totalKobo)}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>What happened?</Text>
        <View style={styles.reasons}>
          {REASONS.map((r) => {
            const active = reason === r;
            return (
              <Pressable key={r} style={[styles.reason, active && styles.reasonActive]} onPress={() => setReason(r)}>
                <View style={[styles.radio, active && styles.radioOn]}>{active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
                <Text style={styles.reasonText}>{r}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={submitting ? 'Filing dispute…' : 'File dispute (priority)'} loading={submitting} onPress={file} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  banner: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  bannerTitle: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  bannerSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  bookingCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  line: { ...Typography.caption, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  reasons: { gap: Spacing.sm },
  reason: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  reasonActive: { borderColor: Colors.primary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  reasonText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  guaranteeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  guaranteeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  successActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
