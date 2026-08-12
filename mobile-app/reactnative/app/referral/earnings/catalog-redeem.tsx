import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { showToast } from '@/store/toastStore';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { useCatalog, useRedeemCatalogItem } from '@/features/referral/earnings/hooks';
import type { CatalogItem, RedeemResult } from '@/features/referral/earnings/types';

// M-ERN-06 — Rewards catalog / redeem: spend points for items.
const ERROR_COPY: Record<NonNullable<RedeemResult['error']>, string> = {
  insufficient_points: 'You do not have enough points for that yet.',
  out_of_stock: 'That item is currently unavailable.',
};

export default function CatalogRedeemScreen() {
  const { data, isLoading, isError, refetch } = useCatalog();
  const redeem = useRedeemCatalogItem();
  const [result, setResult] = useState<RedeemResult | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rewards catalog" />
      {isLoading ? (
        <StateView kind="loading" message="Loading catalog…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.pointsCard}>
            <View style={styles.pointsIcon}><Sparkles size={20} color={Colors.onPrimary} strokeWidth={2} /></View>
            <View>
              <Text style={styles.pointsLabel}>Your points</Text>
              <Text style={styles.pointsValue}>{result?.ok ? result.remainingPoints : data.pointsBalance} pts</Text>
            </View>
          </View>

          {result?.ok && (
            <DisclosureCard tone="compliant" title="Redeemed" body={`${result.item} is on its way. Reference ${result.reference}.`} />
          )}
          {result && !result.ok && result.error && (
            <DisclosureCard tone="warn" body={ERROR_COPY[result.error]} />
          )}

          {data.items.map((item) => (
            <CatalogRow
              key={item.id}
              item={item}
              balance={result?.ok ? result.remainingPoints : data.pointsBalance}
              busy={redeem.isPending}
              onRedeem={() =>
                redeem.mutate(item.id, {
                  onSuccess: setResult,
                  onError: () =>
                    showToast({
                      variant: 'error',
                      title: 'Could not redeem that reward',
                      message: 'Please try again.',
                    }),
                })
              }
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CatalogRow({ item, balance, busy, onRedeem }: { item: CatalogItem; balance: number; busy: boolean; onRedeem: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Gift;
  const affordable = balance >= item.costPoints && item.available;
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardCost}>{item.costPoints} pts{!item.available ? ' · unavailable' : ''}</Text>
      </View>
      <View style={styles.redeemWrap}>
        <PrimaryButton label="Redeem" onPress={onRedeem} disabled={!affordable} loading={busy} fullWidth={false} variant={affordable ? 'primary' : 'ghost'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  pointsCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  pointsIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.onPrimaryContainer, alignItems: 'center', justifyContent: 'center' },
  pointsLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  pointsValue: { ...Typography.titleLg, color: Colors.onPrimary, fontWeight: '800' as const },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...Typography.labelLg, color: Colors.onSurface },
  cardCost: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  redeemWrap: { minWidth: 96, alignItems: 'flex-end' },
});
