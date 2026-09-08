import React from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Trophy, Share2, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNaira } from '@/features/referral/rewards/constants';

// PRD §5.1.6 — Milestone Achieved (celebration). Full-screen celebratory state:
// bonus amount, lifetime milestone total, optional share. Entry via push/param
// (threshold, bonus_kobo, lifetime_kobo). Falls back to the ₦20,000/50 milestone
// so it renders in the offline mock walkthrough.
export default function MilestoneAchieved() {
  const params = useLocalSearchParams<{ threshold?: string; bonus_kobo?: string; lifetime_kobo?: string }>();
  const threshold = Number(params.threshold ?? 50);
  const bonusKobo = Number(params.bonus_kobo ?? 2_000_000);
  const lifetimeKobo = Number(params.lifetime_kobo ?? 2_500_000);

  const onShare = () => {
    Share.share({
      message: `I just hit ${threshold.toLocaleString()} referrals on Spotlight and earned a ${formatNaira(bonusKobo)} bonus! 🎉`,
    }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Pressable onPress={() => goBack('/referral/rewards')} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
        <X size={22} color={Colors.onPrimary} strokeWidth={2} />
      </Pressable>

      <View style={styles.body}>
        <View style={styles.trophyRing}>
          <View style={styles.trophyInner}><Trophy size={52} color={Colors.gold} strokeWidth={1.6} /></View>
        </View>
        <Text style={styles.eyebrow}>Milestone unlocked</Text>
        <Text style={styles.headline}>{threshold.toLocaleString()} active referrals!</Text>
        <Text style={styles.bonusAmount}>{formatNaira(bonusKobo)}</Text>
        <Text style={styles.bonusLabel}>one-time bonus credited to your wallet</Text>

        <View style={styles.lifetimeCard}>
          <Text style={styles.lifetimeLabel}>Lifetime milestone bonuses</Text>
          <Text style={styles.lifetimeValue}>{formatNaira(lifetimeKobo)}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.shareBtn} onPress={onShare} accessibilityRole="button">
          <Share2 size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.shareText}>Share your win</Text>
        </Pressable>
        <Pressable style={styles.doneBtn} onPress={() => goBack('/referral/rewards')} accessibilityRole="button">
          <Text style={styles.doneText}>Keep earning</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.primary },
  close: { alignSelf: 'flex-end', margin: Spacing.md, width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  trophyRing: { width: 132, height: 132, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  trophyInner: { width: 100, height: 100, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...Typography.labelMd, color: Colors.inversePrimary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  headline: { ...Typography.headlineMd, color: Colors.onPrimary, textAlign: 'center', fontWeight: '800' },
  bonusAmount: { ...Typography.displayLg, color: Colors.gold, fontWeight: '800', marginTop: Spacing.sm },
  bonusLabel: { ...Typography.bodyMd, color: Colors.inverseOnSurface, textAlign: 'center' },
  lifetimeCard: { marginTop: Spacing.lg, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, alignItems: 'center', gap: 2 },
  lifetimeLabel: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  lifetimeValue: { ...Typography.titleLg, color: Colors.onPrimary, fontWeight: '800' },
  actions: { padding: Spacing.containerMargin, gap: Spacing.sm },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.white, paddingVertical: 15, borderRadius: Radius.full },
  shareText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' },
  doneBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  doneText: { ...Typography.labelLg, color: Colors.inverseOnSurface, fontWeight: '600' },
});
