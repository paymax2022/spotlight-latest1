// ── Association — Paid-event registration ─────────────────────────────────────
//
// This screen used to treat `registerEvent` AS the charge: it opened the
// purchase sheet, ran register as the "charge" step and then announced
// "Payment received — your ticket is ready". No money moved. Registration now
// RAISES an invoice and answers `paymentRequired` with its id; the money is
// moved by `/association/pay/[invoiceId]`, which debits the wallet, posts the
// ledger entries and issues a receipt. So this screen confirms the fee, raises
// (or re-uses) the invoice, and hands off to that screen.

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { alertAsync } from '@/lib/confirm';
import { useEvent, useRegisterEvent } from '@/features/association/hooks/useCommunity';
import { formatNaira, formatDateTime } from '@/features/association/utils/associationFormatters';

export default function EventPay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const register = useRegisterEvent();

  if (event.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event registration" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (event.isError || !event.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event registration" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Back" onAction={() => goBack('/association')} />
      </SafeAreaView>
    );
  }

  const e = event.data;

  const onContinue = () => {
    register.mutate(e.id, {
      onSuccess: (res) => {
        if (res.paymentRequired && res.invoiceId) {
          // Replace, not push: returning from payment should land on the event,
          // not back on this hand-off screen.
          router.replace(`/association/pay/${res.invoiceId}`);
          return;
        }
        if (res.registered) {
          router.replace(`/association/events/${e.id}`);
          return;
        }
        alertAsync({
          title: 'Not registered yet',
          message: 'No invoice came back for this event, so there is nothing to pay yet. Please try again.',
        });
      },
      onError: (err) => alertAsync({
        title: 'Could not register',
        message: (err as Error)?.message ?? 'Please try again.',
      }),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event registration" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <Text style={styles.title}>{e.title}</Text>
          <Text style={styles.sub}>{formatDateTime(e.startsAt)}</Text>
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Registration fee</Text>
            <Text style={styles.amount}>{formatNaira(e.feeKobo)}</Text>
          </View>
        </View>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>How this works</Text>
          <Step n={1} text="We hold your place and raise an invoice for the fee." />
          <Step n={2} text="You settle that invoice on the payment screen." />
          <Step n={3} text="Your ticket is issued once the payment goes through." />
          <Text style={styles.stepsNote}>
            Continuing twice does not raise a second invoice — you are returned to the same one.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Continue · ${formatNaira(e.feeKobo)}`}
          onPress={onContinue}
          loading={register.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
    marginHorizontal: Spacing.containerMargin, gap: 2,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  stepsCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, marginHorizontal: Spacing.containerMargin, gap: Spacing.sm,
  },
  stepsTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepNum: {
    width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  stepText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  stepsNote: { ...Typography.caption, color: Colors.outline },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
});
