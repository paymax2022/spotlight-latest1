import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ShieldCheck, CircleCheckBig } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useQuote, useCustomer, useAgentBook, type AgentBooking } from '@/features/stays/agent';
import { formatNaira, formatStayRange, StaysColors } from '@/features/stays/constants/stays.constants';

/** Agent: confirm booking on customer's behalf (PRD §20.6) — prebook→book. */
export default function AgentConfirmScreen() {
  const { quoteId, customerId } = useLocalSearchParams<{ quoteId: string; customerId: string }>();
  const quote = useQuote(quoteId ?? '');
  const customer = useCustomer(customerId ?? '');
  const bookM = useAgentBook();
  const [consent, setConsent] = useState(false);
  const [booking, setBooking] = useState<AgentBooking | null>(null);

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Confirm booking" />
        <StateView kind="loading" message="Loading quote…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Confirm booking" />
        <StateView kind="error" icon="Clock" title="Quote expired" actionLabel="Find customer" onAction={() => router.replace('/stays/agent/customer-lookup')} />
      </SafeAreaView>
    );
  }

  const q = quote.data;

  if (booking) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking confirmed" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheckBig size={48} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Confirmed for {booking.customerName}</Text>
          <Text style={styles.successRef}>{booking.reference}</Text>
          <Text style={styles.successMsg}>The reservation is on the customer's account. Your commission of {formatNaira(booking.commissionKobo)} is recorded.</Text>
          <View style={styles.successActions}>
            <PrimaryButton label="View bookings" onPress={() => router.replace('/stays/agent/book')} />
            <PrimaryButton label="New booking" variant="secondary" onPress={() => router.replace('/stays/agent/customer-lookup')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  function confirm() {
    if (!quoteId || !consent) return;
    bookM.mutate(quoteId, { onSuccess: (b) => setBooking(b) });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm booking" subtitle="On customer's behalf" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.idCard}>
          <ShieldCheck size={16} color={StaysColors.ok} />
          <Text style={styles.idText}>Booking will be created on {customer.data?.fullName ?? 'the customer'}'s account.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.name}>{q.propertyName}</Text>
          <Text style={styles.line}>{q.city}</Text>
          <Text style={styles.line}>{formatStayRange(q.checkIn, q.checkOut)}</Text>
          <Text style={styles.line}>{q.roomTypeName} · {q.ratePlanName}</Text>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total (NGN)</Text>
            <Text style={styles.totalVal}>{formatNaira(q.totalKobo)}</Text>
          </View>
          <Text style={styles.comm}>Your commission: {formatNaira(q.commissionKobo)}</Text>
        </View>

        <Pressable style={styles.consentRow} onPress={() => setConsent((c) => !c)}>
          <View style={[styles.checkbox, consent && styles.checkboxOn]}>{consent ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
          <Text style={styles.consentText}>The customer has consented to this booking and to sharing their details with the property (NDPA 2023).</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={bookM.isPending ? 'Confirming…' : 'Confirm & book'} loading={bookM.isPending} disabled={!consent} onPress={confirm} />
        {bookM.isError ? <Text style={styles.err}>Couldn't confirm. The hold may have expired — try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  idCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  idText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  comm: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  consentRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successRef: { ...Typography.labelLg, color: Colors.primary },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  successActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
