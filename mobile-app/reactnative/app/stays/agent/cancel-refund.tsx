import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Wallet, Check, CircleCheckBig } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAgentBooking, useAgentCancel } from '@/features/stays/agent';
import { formatNaira, formatStayRange, StaysColors } from '@/features/stays/constants/stays.constants';

/** Agent: assisted cancel / refund (PRD §20.9). */
export default function AgentCancelRefundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useAgentBooking(id ?? '');
  const cancelM = useAgentCancel();
  const [confirm, setConfirm] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  if (booking.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel / refund" />
        <StateView kind="loading" message="Loading booking…" />
      </SafeAreaView>
    );
  }
  if (booking.isError || !booking.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel / refund" />
        <StateView kind="error" title="Booking not found" actionLabel="Bookings" onAction={() => router.replace('/stays/agent/book')} />
      </SafeAreaView>
    );
  }

  const b = booking.data;
  const alreadyCancelled = b.status === 'CANCELLED';

  if (cancelled || alreadyCancelled) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancelled" showBack={!cancelled} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheckBig size={48} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Booking cancelled</Text>
          <Text style={styles.successMsg}>The refund (if any) was credited to {b.customerName}'s wallet as a reversing ledger entry.</Text>
          <View style={styles.successActions}>
            <PrimaryButton label="Back to bookings" onPress={() => router.replace('/stays/agent/book')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  function cancel() {
    if (!id || !confirm) return;
    cancelM.mutate(id, { onSuccess: () => setCancelled(true) });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cancel / refund" subtitle={b.reference} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.name}>{b.propertyName}</Text>
          <Text style={styles.line}>{b.customerName} · {b.city}</Text>
          <Text style={styles.line}>{formatStayRange(b.checkIn, b.checkOut)}</Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Paid</Text>
            <Text style={styles.rowVal}>{formatNaira(b.totalKobo)}</Text>
          </View>
        </View>

        <View style={styles.refundCard}>
          <Wallet size={16} color={Colors.primary} />
          <Text style={styles.refundText}>Eligible refund of {formatNaira(b.totalKobo)} will be credited to the customer's wallet instantly.</Text>
        </View>

        <Pressable style={styles.consentRow} onPress={() => setConfirm((c) => !c)}>
          <View style={[styles.checkbox, confirm && styles.checkboxOn]}>{confirm ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
          <Text style={styles.consentText}>The customer has authorised this cancellation and refund.</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Keep booking" variant="secondary" onPress={() => goBack('/stays')} />
        <PrimaryButton label={cancelM.isPending ? 'Cancelling…' : 'Cancel & refund'} variant="danger" loading={cancelM.isPending} disabled={!confirm} onPress={cancel} />
        {cancelM.isError ? <Text style={styles.err}>Couldn't cancel. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' as const },
  refundCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  refundText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  consentRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  successActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
