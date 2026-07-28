import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Gift, Users, TrendingUp, ChevronRight, Wallet, Share2, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useReferralDashboard } from '@/features/referral/rewards/hooks';
import { formatNaira, formatRate, tierDef, TIER_TABLE, RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, TierBadge, ProgressBar, Card } from '@/features/referral/rewards/components';

// PRD §5.1.1 — Referral Hub (home). The emotional center: tier badge, active
// count + progress to next tier, this-month + lifetime earnings, next-milestone
// preview. Zero-referral state is an invitation, not a blank dashboard.
export default function ReferralHub() {
  const { data, isLoading, isError, refetch } = useReferralDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader
        eyebrow="Refer & Earn"
        title="Referral rewards"
        showBack
        right={
          <Pressable onPress={() => router.push('/referral/rewards/notifications')} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Notification preferences">
            <Award size={19} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load your rewards" actionLabel="Retry" onAction={refetch} />
      ) : !data ? null : data.active_referral_count === 0 ? (
        // Zero-state = invitation (PRD §5.1.1).
        <ScrollView contentContainerStyle={styles.zeroWrap}>
          <View style={styles.zeroIcon}><Gift size={40} color={Colors.primary} strokeWidth={1.6} /></View>
          <Text style={styles.zeroTitle}>Invite your first person</Text>
          <Text style={styles.zeroBody}>
            You start earning when someone you invited makes their first purchase — on bills, shopping,
            insurance, transport, and more. You never earn just for referring.
          </Text>
          <Pressable style={styles.zeroCta} onPress={() => router.push('/referral/rewards/share')} accessibilityRole="button">
            <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.zeroCtaText}>Share your invite</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/referral/rewards/tiers')} hitSlop={8}>
            <Text style={styles.zeroLink}>See how earning works</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Tier + progress hero */}
          <Card style={styles.hero}>
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroLabel}>Your tier</Text>
                <View style={styles.heroTierRow}>
                  <TierBadge tier={data.current_tier} />
                  <Text style={styles.heroRate}>{formatRate(data.current_rate)} of margin</Text>
                </View>
              </View>
              <View style={styles.heroCount}>
                <Text style={styles.heroCountNum}>{data.active_referral_count}</Text>
                <Text style={styles.heroCountLabel}>active</Text>
              </View>
            </View>
            {renderTierProgress(data.current_tier, data.active_referral_count)}
          </Card>

          {/* Earnings */}
          <View style={styles.earnRow}>
            <Card style={styles.earnCard}>
              <Text style={styles.earnLabel}>This month</Text>
              <Text style={styles.earnValue}>{formatNaira(data.this_month_earned_kobo)}</Text>
            </Card>
            <Card style={styles.earnCard}>
              <Text style={styles.earnLabel}>Lifetime</Text>
              <Text style={styles.earnValue}>{formatNaira(data.lifetime_earned_kobo)}</Text>
            </Card>
          </View>

          {/* Next milestone preview */}
          {data.next_milestone ? (
            <Pressable onPress={() => router.push('/referral/rewards/tiers')}>
              <Card style={styles.milestoneCard}>
                <View style={styles.milestoneIcon}><Award size={22} color={RewardColors.warnText} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.milestoneTitle}>
                    {data.active_referral_count} of {data.next_milestone.threshold} — {formatNaira(data.next_milestone.bonus_kobo)} bonus incoming
                  </Text>
                  <Text style={styles.milestoneBody}>
                    {data.next_milestone.remaining} more active {data.next_milestone.remaining === 1 ? 'referral' : 'referrals'} to unlock this one-time bonus.
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Card>
            </Pressable>
          ) : null}

          {/* Quick actions */}
          <View style={styles.actions}>
            <ActionRow icon={Share2} label="Invite someone" sub="Share your code, link and QR" onPress={() => router.push('/referral/rewards/share')} />
            <ActionRow icon={Users} label="My referrals" sub={`${data.active_referral_count} active`} onPress={() => router.push('/referral/rewards/referrals')} />
            <ActionRow icon={Gift} label="Earnings history" sub="Every reward, transaction by transaction" onPress={() => router.push('/referral/rewards/earnings')} />
            <ActionRow icon={TrendingUp} label="Tiers & rewards" sub="How the rates and bonuses work" onPress={() => router.push('/referral/rewards/tiers')} />
            <ActionRow icon={Wallet} label="Go to wallet" sub="Spend or withdraw your earnings" onPress={() => router.push('/wallet')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function renderTierProgress(tier: string, count: number) {
  const idx = TIER_TABLE.findIndex((t) => t.tier === tier);
  const next = TIER_TABLE[idx + 1];
  if (!next) {
    return <Text style={styles.maxTier}>You've reached the top tier. Every future referral purchase earns {formatRate(TIER_TABLE[idx].rate)}.</Text>;
  }
  const current = TIER_TABLE[idx];
  const span = next.min_count - current.min_count;
  const progress = span > 0 ? (count - current.min_count) / span : 0;
  const remaining = Math.max(0, next.min_count - count);
  return (
    <View style={styles.progressWrap}>
      <ProgressBar progress={progress} />
      <Text style={styles.progressLabel}>
        {remaining} more to <Text style={styles.progressNext}>{next.label}</Text> ({formatRate(next.rate)})
      </Text>
    </View>
  );
}

function ActionRow({ icon: Icon, label, sub, onPress }: { icon: typeof Gift; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={styles.actionRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.actionIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionSub}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },

  hero: { gap: Spacing.md },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  heroTierRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroRate: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '600' },
  heroCount: { alignItems: 'flex-end' },
  heroCountNum: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' },
  heroCountLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  progressWrap: { gap: Spacing.sm },
  progressLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  progressNext: { color: Colors.onSurface, fontWeight: '700' },
  maxTier: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  earnRow: { flexDirection: 'row', gap: Spacing.md },
  earnCard: { flex: 1, gap: Spacing.xs },
  earnLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  earnValue: { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '800' },

  milestoneCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  milestoneIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  milestoneTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  milestoneBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },

  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: RewardColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: RewardColors.border, padding: Spacing.md },
  actionIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' },
  actionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  zeroWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  zeroIcon: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  zeroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  zeroBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  zeroCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: 14, borderRadius: Radius.full, marginTop: Spacing.sm },
  zeroCtaText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' },
  zeroLink: { ...Typography.labelMd, color: Colors.secondary, fontWeight: '600', marginTop: Spacing.sm },
});
