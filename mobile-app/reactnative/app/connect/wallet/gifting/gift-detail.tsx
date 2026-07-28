import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import { useGiftTransaction } from '@/features/connect/wallet/hooks';

// WL-10 — Single gift receipt.
export default function GiftDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useGiftTransaction(id ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Gift detail" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load gift" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.hero}>
            <Text style={styles.emoji}>{data.product.emoji}</Text>
            <MoneyAmount kobo={data.amountKobo} size="xl" />
            <Text style={styles.heroTitle}>{data.product.name}</Text>
          </View>

          <View style={styles.card}>
            <Row label="Reference" value={data.ref} />
            {data.sender ? <Row label="From" value={data.sender.displayName} /> : null}
            <Row label="To" value={data.recipient.displayName} />
            <Row label="Status" value={data.status} />
            <Row label="Date" value={new Date(data.createdAt).toLocaleString('en-NG')} />
            {data.message ? <Row label="Message" value={data.message} /> : null}
          </View>

          <PrimaryButton label="Done" variant="secondary" onPress={() => router.back()} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.lg },
  emoji: { fontSize: 48 },
  heroTitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
});
