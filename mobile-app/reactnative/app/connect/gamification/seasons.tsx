import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Lock, CircleCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors, SEASON_PASS_PRICE_KOBO } from '@/features/connect/constants/connect.constants';
import { useSeason, useUnlockSeasonPass } from '@/features/connect/gamification/hooks';
import type { SeasonReward } from '@/features/connect/gamification/types';
import { formatKobo } from '@/features/connect/constants/format';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

function pascal(kebab: string): string {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** Seasons / season pass (PRD §10.10 GM-06). Rewards are NON-CASH. */
export default function SeasonsScreen() {
  const q = useSeason();
  const unlock = useUnlockSeasonPass();
  const checkout = usePurchasePayment();

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Season" /><StateView kind="loading" message="Loading season…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Season" /><StateView kind="error" title="Couldn't load season" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;
  const s = q.data;

  const unlockPass = () => checkout.start({
    amountKobo: SEASON_PASS_PRICE_KOBO,
    title: `${s.name} — Premium track`,
    domain: 'connect_season_pass',
    charge: () => unlock.mutateAsync(s.id),
    onPaid: () => Alert.alert('Premium track unlocked', 'Your premium rewards are now available to claim. These are cosmetics and coins — no cash value.'),
  });
  const daysLeft = Math.max(0, Math.ceil((new Date(s.endsAtIso).getTime() - Date.now()) / 86_400_000));
  const passPct = Math.min(100, Math.round((s.passXp / s.passXpToNext) * 100));

  function rewardIcon(r: SeasonReward) {
    const Cmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[pascal(r.icon)] ?? Icons.Gift;
    return <Cmp size={20} color={r.unlocked ? ConnectColors.brand : Colors.onSurfaceVariant} strokeWidth={2.2} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title={s.name} subtitle={s.theme} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: s.bannerUrl }} style={styles.banner} resizeMode="cover" />
        <View style={styles.timer}><Clock size={13} color={ConnectColors.brand} strokeWidth={2.2} /><Text style={styles.timerText}>{daysLeft} days left</Text></View>

        <View style={styles.passCard}>
          <Text style={styles.passLabel}>Season pass · Tier {s.passTier}/{s.passTotalTiers}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${passPct}%` }]} /></View>
          <Text style={styles.passXp}>{s.passXp.toLocaleString('en-NG')} / {s.passXpToNext.toLocaleString('en-NG')} season XP</Text>
        </View>

        <GameNonCashNotice message="Season pass rewards are cosmetics, boosts and coins — never cash. Coins can't be withdrawn." />

        <Text style={styles.sectionLabel}>Rewards track</Text>
        {s.rewards.map((r) => (
          <View key={r.tier} style={[styles.rewardRow, !r.unlocked && styles.rewardLocked]}>
            <View style={styles.rewardIcon}>{rewardIcon(r)}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardLabel}>{r.label}</Text>
              <Text style={[styles.rewardTrack, r.track === 'premium' && styles.rewardPremium]}>Tier {r.tier} · {r.track === 'premium' ? 'Premium' : 'Free'}</Text>
            </View>
            {r.claimed ? <CircleCheck size={18} color={ConnectColors.ok} strokeWidth={2} /> : !r.unlocked ? <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <Text style={styles.claimable}>Ready</Text>}
          </View>
        ))}
      </ScrollView>

      {!s.isPassUnlocked ? (
        <View style={styles.footer}>
          <PrimaryButton label={`Unlock premium track · ${formatKobo(SEASON_PASS_PRICE_KOBO)}`} variant="secondary" loading={unlock.isPending} onPress={unlockPass} />
          <Text style={styles.footerNote}>Unlocking the premium track is a one-time in-app purchase. It grants cosmetic rewards and coins only — no cash value.</Text>
        </View>
      ) : null}

      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  banner: { width: '100%', aspectRatio: 2.2, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainer },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: Colors.iconBgPurple, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  timerText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' as const },
  passCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md, gap: Spacing.sm },
  passLabel: { ...Typography.labelLg, color: Colors.onSurface },
  track: { height: 9, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  passXp: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  rewardLocked: { opacity: 0.7 },
  rewardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rewardLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rewardTrack: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rewardPremium: { color: ConnectColors.warn },
  claimable: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' as const },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border, gap: Spacing.sm },
  footerNote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
