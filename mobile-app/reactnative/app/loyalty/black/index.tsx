import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Crown, Check, Gift, ChevronRight, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import BlackPerkCard from '@/features/loyalty/components/black-PerkCard';
import { useBlackStatus, useBlackPerks, formatPoints, BLACK_BENEFITS, BLACK_THRESHOLD_POINTS } from '@/features/loyalty/black';
import { LoyaltyColors } from '@/features/loyalty/constants/loyalty.constants';

export default function BlackLanding() {
  const status = useBlackStatus();
  const perks = useBlackPerks();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/loyalty')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Paymax Black</Text>
        <View style={styles.iconBtn} />
      </View>

      {status.isLoading ? (
        <StateView kind="loading" message="Loading Paymax Black…" />
      ) : status.isError || !status.data ? (
        <StateView kind="error" title="Couldn't load Paymax Black" actionLabel="Retry" onAction={() => status.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero card */}
          <View style={styles.heroCard}>
            <Crown size={32} color={Colors.gold} />
            <Text style={styles.heroTitle}>Paymax Black</Text>
            <Text style={styles.heroSub}>
              {status.data.isBlack
                ? `You're a Black member${status.data.memberSinceISO ? ` since ${new Date(status.data.memberSinceISO).getFullYear()}` : ''}.`
                : status.data.eligibility === 'eligible'
                ? "You've qualified — unlock the highest tier of Spotlight perks."
                : `Reach ${formatPoints(BLACK_THRESHOLD_POINTS)} lifetime to unlock.`}
            </Text>
            <Text style={styles.heroPoints}>{formatPoints(status.data.lifetimePoints)} lifetime</Text>
            {!status.data.isBlack && status.data.eligibility === 'locked' ? (
              <View style={styles.lockRow}><Lock size={13} color="#D3BBFF" /><Text style={styles.lockText}>{formatPoints(status.data.pointsToUnlock)} to go</Text></View>
            ) : null}
          </View>

          {/* Benefits */}
          <Text style={styles.section}>Black benefits</Text>
          <View style={styles.benefitsCard}>
            {BLACK_BENEFITS.map((b) => (
              <View key={b} style={styles.benefitRow}><Check size={16} color={LoyaltyColors.ok} /><Text style={styles.benefitText}>{b}</Text></View>
            ))}
          </View>

          {/* CTAs */}
          {status.data.isBlack ? (
            <>
              <Pressable style={styles.linkCard} onPress={() => router.push('/loyalty/black/redeem')}>
                <View style={styles.linkIcon}><Gift size={20} color={LoyaltyColors.brandText} /></View>
                <View style={{ flex: 1 }}><Text style={styles.linkTitle}>Redeem a perk</Text><Text style={styles.linkSub}>Get a venue credential</Text></View>
                <ChevronRight size={18} color={LoyaltyColors.muted} />
              </Pressable>
              <Pressable style={styles.linkCard} onPress={() => router.push('/loyalty/black/partners')}>
                <View style={styles.linkIcon}><Crown size={20} color={LoyaltyColors.brandText} /></View>
                <View style={{ flex: 1 }}><Text style={styles.linkTitle}>Partner offers</Text><Text style={styles.linkSub}>Exclusive Black deals</Text></View>
                <ChevronRight size={18} color={LoyaltyColors.muted} />
              </Pressable>
            </>
          ) : (
            <PrimaryButton
              label={status.data.eligibility === 'eligible' ? 'Upgrade to Black' : 'Keep earning to unlock'}
              onPress={() => router.push('/loyalty/black/upgrade')}
              disabled={status.data.eligibility !== 'eligible'}
              style={{ marginTop: Spacing.md }}
            />
          )}

          {/* Perk preview */}
          {!perks.isLoading && (perks.data?.length ?? 0) > 0 ? (
            <>
              <Text style={styles.section}>Perks</Text>
              <View style={{ gap: Spacing.sm }}>
                {perks.data!.map((p) => (
                  <BlackPerkCard key={p.id} perk={p} onRedeem={() => router.push('/loyalty/black/redeem')} />
                ))}
              </View>
            </>
          ) : null}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  heroCard: { backgroundColor: '#1A0050', borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 6 },
  heroTitle: { ...Typography.headlineMd, color: '#FFFFFF' },
  heroSub: { ...Typography.bodyMd, color: '#D3BBFF', textAlign: 'center' },
  heroPoints: { ...Typography.titleMd, color: Colors.gold, marginTop: 4 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lockText: { ...Typography.labelSm, color: '#D3BBFF' },
  section: { ...Typography.titleMd, color: LoyaltyColors.text, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  benefitsCard: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { ...Typography.bodyMd, color: LoyaltyColors.text, flex: 1 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm, ...shadow1 },
  linkIcon: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: LoyaltyColors.brandBg },
  linkTitle: { ...Typography.titleMd, color: LoyaltyColors.text },
  linkSub: { ...Typography.bodySm, color: LoyaltyColors.muted },
});
