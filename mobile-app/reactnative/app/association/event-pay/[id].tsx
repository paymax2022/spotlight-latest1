import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEvent, useRegisterEvent } from '@/features/association/hooks/useCommunity';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function EventPay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const register = useRegisterEvent();
  const checkout = usePurchasePayment();

  if (event.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event payment" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (event.isError || !event.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event payment" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const e = event.data;

  const onPay = () => {
    checkout.start({
      amountKobo: e.feeKobo,
      title: e.title,
      charge: () => register.mutateAsync(e.id),
      onPaid: () => { Alert.alert('Registered', 'Payment received — your ticket is ready.'); router.replace(`/association/events/${e.id}`); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event payment" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <Text style={styles.title}>{e.title}</Text>
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Registration fee</Text>
            <Text style={styles.amount}>{formatNaira(e.feeKobo)}</Text>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={`Pay ${formatNaira(e.feeKobo)} & register`} onPress={onPay} loading={register.isPending} />
      </View>
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  amountBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
