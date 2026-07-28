import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gift, Copy, Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useReferrals } from '@/features/fractionalre/hooks';
import { formatNaira } from '@/features/fractionalre/utils';
import type { Referrals, ReferralSummary } from '@/features/fractionalre/types';

function isEnabled(r: Referrals): r is ReferralSummary {
  return r.enabled !== false && 'code' in r;
}

export default function ReferralsScreen() {
  const referrals = useReferrals();

  if (referrals.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Referrals" />
        <StateView kind="loading" message="Loading referrals…" />
      </SafeAreaView>
    );
  }

  if (referrals.isError || !referrals.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Referrals" />
        <StateView
          kind="error"
          title="Couldn't load referrals"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => referrals.refetch()}
        />
      </SafeAreaView>
    );
  }

  const data = referrals.data;

  if (!isEnabled(data)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Referrals" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Gift size={28} color={Colors.gold} strokeWidth={2} /></View>
            <Text style={styles.heroTitle}>Referral rewards are coming soon</Text>
            <Text style={styles.heroSub}>
              We're putting the finishing touches on referral rewards. Check back here soon to invite friends and earn together.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const code = data.code;
  const onShare = () => {
    Share.share({ message: `Invest in real estate fractions on Paymax. Use my code ${code} to get started.` }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Referrals" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Gift size={28} color={Colors.gold} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>Invite friends, earn rewards</Text>
          <Text style={styles.heroSub}>You and your friend both earn a reward when they make their first investment.</Text>
        </View>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your referral code</Text>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{code}</Text>
            <Pressable hitSlop={8} onPress={onShare}><Copy size={18} color={Colors.secondary} strokeWidth={2} /></Pressable>
          </View>
        </View>

        <Pressable style={styles.shareBtn} onPress={onShare}>
          <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
          <Text style={styles.shareText}>Share invite</Text>
        </Pressable>

        <View style={styles.stats}>
          <Stat label="Invited" value={String(data.invited)} />
          <Stat label="Joined" value={String(data.joined)} />
          <Stat label="Earned" value={formatNaira(data.earned_kobo)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  heroSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  codeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: 6, borderWidth: 1, borderColor: Colors.outlineVariant },
  codeLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { ...Typography.headlineMd, color: Colors.onSurface, letterSpacing: 1 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md },
  shareText: { ...Typography.labelLg, color: Colors.onPrimary },
  stats: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg },
  stat: { alignItems: 'center' },
  statVal: { ...Typography.titleLg, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
