import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PriceBreakdown } from '@/features/stays/components';
import { useStaysStore } from '@/features/stays/store';
import { usePreviewBreakdown } from '@/features/stays/hooks';

export default function PriceBreakdownScreen() {
  const { draft, addOnKeys, promoCode, useLoyalty } = useStaysStore();
  const preview = usePreviewBreakdown(
    draft ? { draft, addOnKeys, promoCode, useLoyalty } : ({} as any),
    !!draft,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Price breakdown" subtitle="Step 3 of 5 · room, taxes, fees & discounts" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!draft ? (
          <StateView kind="empty" icon="ReceiptText" title="No booking" message="Start a booking to see pricing." />
        ) : preview.isLoading ? (
          <StateView kind="loading" message="Calculating…" />
        ) : preview.isError || !preview.data ? (
          <StateView kind="error" title="Price unavailable" actionLabel="Retry" onAction={() => preview.refetch()} />
        ) : (
          <>
            <PriceBreakdown data={preview.data} />
            <Text style={styles.note}>
              Taxes (VAT 7.5%) and a 5% service charge are included. All amounts are settled in Naira from your wallet.
            </Text>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Choose payment method" onPress={() => router.push('/stays/book/payment-method')} disabled={!preview.data} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
