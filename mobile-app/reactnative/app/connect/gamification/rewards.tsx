import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Coins, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useGamificationProfile, useRewards, useRedeemReward } from '@/features/connect/gamification/hooks';
import type { CatalogReward } from '@/features/connect/gamification/types';

function pascal(kebab: string): string {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** Rewards center (PRD §10.10 GM-04): redeem NON-CASH coins for in-app rewards. */
export default function RewardsScreen() {
  const profile = useGamificationProfile();
  const q = useRewards();
  const redeem = useRedeemReward();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const coins = profile.data?.coins ?? 0;

  function onRedeem(r: CatalogReward) {
    if (r.owned || coins < r.costCoins) return;
    setPendingId(r.id);
    redeem.mutate(r.id, { onSettled: () => setPendingId(null) });
  }

  function renderItem({ item }: { item: CatalogReward }) {
    const affordable = coins >= item.costCoins;
    const busy = pendingId === item.id;
    const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[pascal(item.icon)] ?? Icons.Gift;
    return (
      <View style={styles.card}>
        <View style={styles.cardIcon}><IconCmp size={24} color={ConnectColors.brand} strokeWidth={2.2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
          <View style={styles.priceRow}>
            <Coins size={13} color={ConnectColors.warn} strokeWidth={2.2} />
            <Text style={styles.price}>{item.costCoins.toLocaleString('en-NG')} coins</Text>
          </View>
        </View>
        {item.owned ? (
          <View style={styles.ownedPill}><CircleCheck size={14} color={ConnectColors.ok} strokeWidth={2.2} /><Text style={styles.ownedText}>Owned</Text></View>
        ) : (
          <Pressable
            style={[styles.redeemBtn, !affordable && styles.redeemDisabled]}
            disabled={!affordable || busy}
            onPress={() => onRedeem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Redeem ${item.name}`}
          >
            <Text style={[styles.redeemText, !affordable && styles.redeemTextDisabled]}>{busy ? '…' : affordable ? 'Redeem' : 'Need more'}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Rewards"
        subtitle="Spend coins on in-app perks"
        rightSlot={
          <View style={styles.balancePill}>
            <Coins size={13} color={ConnectColors.warn} strokeWidth={2.2} />
            <Text style={styles.balanceText}>{coins.toLocaleString('en-NG')}</Text>
          </View>
        }
      />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading rewards…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load rewards" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Gift" title="No rewards yet" message="New rewards are added regularly." />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={{ marginBottom: Spacing.sm }}><GameNonCashNotice message="Coins are earned by activity. They redeem for cosmetics and boosts only — they are not cash and cannot be withdrawn." /></View>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  balancePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  balanceText: { ...Typography.labelMd, color: Colors.onWarning, fontWeight: '700' as const },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  cardIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  price: { ...Typography.labelMd, color: Colors.onSurface },
  redeemBtn: { backgroundColor: ConnectColors.brand, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.full },
  redeemDisabled: { backgroundColor: Colors.surfaceContainerHigh },
  redeemText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  redeemTextDisabled: { color: Colors.onSurfaceVariant },
  ownedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: ConnectColors.okBg },
  ownedText: { ...Typography.labelMd, color: ConnectColors.ok, fontWeight: '700' as const },
});
