import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { X, Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useRewardCatalog, useRewardBalance, useRedeemReward, useMe } from '@/features/academy/hooks';
import { formatPoints } from '@/features/academy/constants';

/** G7 — Redeem rewards. Points → data / airtime / wallet / exam pass. Minor-gated. */
export default function RedeemRewards() {
  const catalog = useRewardCatalog();
  const balance = useRewardBalance();
  const redeem = useRedeemReward();
  const me = useMe();
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = me.data?.isMinor && me.data?.guardianConsent !== 'granted';
  const points = balance.data?.points ?? 0;
  const item = catalog.data?.find((i) => i.id === picked);
  const affordable = item ? points >= item.pointsCost : false;

  const doRedeem = () => {
    if (!item) return;
    setError(null);
    redeem.mutate(item.id, {
      onSuccess: () => setDone(true),
      onError: (e) => setError(e instanceof Error ? e.message : 'Redemption failed'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Redeem rewards</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}><X size={24} color={Colors.onSurface} /></Pressable>
      </View>

      {done ? (
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><Check size={32} color={Colors.onPrimary} strokeWidth={3} /></View>
          <Text style={styles.successTitle}>Redeemed!</Text>
          <Text style={styles.successSub}>{item?.name} is on its way. {item?.walletValueKobo ? 'Wallet credited.' : ''} The redemption will reconcile if you’re offline.</Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}><PrimaryButton label="Done" onPress={() => router.back()} /></View>
        </View>
      ) : locked ? (
        <View style={styles.lockedWrap}>
          <Lock size={28} color={Colors.onWarning} />
          <Text style={styles.lockedTitle}>Guardian consent required</Text>
          <Text style={styles.lockedSub}>Under-18 learners need a parent or guardian to consent before redeeming rewards.</Text>
        </View>
      ) : catalog.isLoading ? (
        <StateView kind="loading" message="Loading catalog…" />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.balance}>Balance: {formatPoints(points)}</Text>
            {catalog.data?.map((i) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[i.icon] ?? Icons.Gift;
              const canAfford = points >= i.pointsCost;
              const active = picked === i.id;
              return (
                <Pressable key={i.id} style={[styles.card, shadow1, active && styles.cardActive, !canAfford && styles.cardDim]} onPress={() => canAfford && setPicked(i.id)} disabled={!canAfford}>
                  <View style={styles.iconBox}><Icon size={22} color={Colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{i.name}</Text>
                    <Text style={styles.cardDesc}>{i.description}</Text>
                  </View>
                  <View style={styles.costWrap}>
                    <Text style={styles.cost}>{i.pointsCost.toLocaleString()}</Text>
                    <Text style={styles.costLabel}>pts</Text>
                    {active ? <Check size={16} color={Colors.primary} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label={item ? `Redeem for ${item.pointsCost.toLocaleString()} pts` : 'Select a reward'} onPress={doRedeem} disabled={!item || !affordable} loading={redeem.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.containerMargin },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  balance: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.transparent },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  cardDim: { opacity: 0.5 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...Typography.titleMd, color: Colors.onSurface },
  cardDesc: { ...Typography.caption, color: Colors.onSurfaceVariant },
  costWrap: { alignItems: 'center' },
  cost: { ...Typography.titleMd, color: Colors.primary },
  costLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
  lockedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  lockedTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  lockedSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
