import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Wallet, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrip, useCancellationPreview, useCancelTrip } from '@/features/stays/trips';
import { formatNaira, formatStayRange, StaysColors } from '@/features/stays/constants/stays.constants';

export default function CancelBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');
  const preview = useCancellationPreview(id ?? '');
  const cancelM = useCancelTrip();
  const [confirm, setConfirm] = useState(false);

  if (trip.isLoading || preview.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel booking" />
        <StateView kind="loading" message="Checking your cancellation policy…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || preview.isError || !trip.data || !preview.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel booking" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Retry" onAction={() => preview.refetch()} />
      </SafeAreaView>
    );
  }

  const t = trip.data;
  const p = preview.data;

  function onCancel() {
    if (!id) return;
    cancelM.mutate(id, {
      onSuccess: () => router.replace({ pathname: '/stays/trips/refund-status', params: { id } }),
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cancel booking" subtitle={t.propertyName} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Text style={styles.name}>{t.propertyName}</Text>
          <Text style={styles.line}>{formatStayRange(t.checkIn, t.checkOut)}</Text>
          <Text style={styles.line}>{t.roomTypeName} · {t.ratePlanName}</Text>
        </View>

        <View style={[styles.policyCard, p.freeCancel ? styles.policyOk : styles.policyWarn]}>
          <ShieldCheck size={18} color={p.freeCancel ? StaysColors.ok : Colors.onWarning} strokeWidth={2.2} />
          <Text style={styles.policyText}>{p.policyText}</Text>
        </View>

        <View style={styles.breakdown}>
          <Text style={styles.bdTitle}>Refund preview</Text>
          {p.legs.map((l, i) => {
            const neg = l.amountKobo < 0;
            return (
              <View key={i} style={styles.bdRow}>
                <Text style={styles.bdLabel}>{l.label}</Text>
                <Text style={[styles.bdVal, neg && { color: Colors.error }]}>
                  {neg ? '-' : ''}{formatNaira(Math.abs(l.amountKobo))}
                </Text>
              </View>
            );
          })}
          <View style={styles.divider} />
          <View style={styles.bdRow}>
            <View style={styles.refundLabelWrap}>
              <Wallet size={16} color={Colors.primary} />
              <Text style={styles.refundLabel}>Refund to wallet</Text>
            </View>
            <Text style={styles.refundVal}>{formatNaira(p.refundableKobo)}</Text>
          </View>
          {p.instant ? <Text style={styles.instant}>Instant credit to your Paymax wallet on cancellation.</Text> : null}
        </View>

        <Pressable style={styles.consent} onPress={() => setConfirm((c) => !c)}>
          <View style={[styles.checkbox, confirm && styles.checkboxOn]}>{confirm ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
          <Text style={styles.consentText}>I understand the refund shown above and want to cancel this booking.</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Keep booking" variant="secondary" onPress={() => router.back()} />
        <PrimaryButton
          label={cancelM.isPending ? 'Cancelling…' : 'Cancel booking'}
          variant="danger"
          loading={cancelM.isPending}
          disabled={!confirm}
          onPress={onCancel}
        />
        {cancelM.isError ? <Text style={styles.err}>Couldn't cancel. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  policyCard: { flexDirection: 'row', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center' },
  policyOk: { backgroundColor: Colors.iconBgTeal },
  policyWarn: { backgroundColor: Colors.iconBgGold },
  policyText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  breakdown: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  bdTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bdLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  bdVal: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600' as const },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  refundLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  refundLabel: { ...Typography.titleMd, color: Colors.onSurface },
  refundVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  instant: { ...Typography.caption, color: StaysColors.ok },
  consent: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
});
