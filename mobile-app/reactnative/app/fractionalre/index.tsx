import React, { useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Wallet, ArrowRight, ChevronRight, ShieldAlert, Calendar, Compass, PieChart, Store, GraduationCap, UserCog,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useInvestorProfile, usePortfolio, useOfferings } from '@/features/fractionalre/hooks';
import { formatNaira, formatNairaCompact, relativeDate } from '@/features/fractionalre/utils';
import OpportunityCard from '@/features/fractionalre/components/OpportunityCard';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function FractionalReHome() {
  const profile = useInvestorProfile();
  const portfolio = usePortfolio();
  const featured = useOfferings();

  // Gate: if the investor hasn't activated yet, send them to onboarding.
  useEffect(() => {
    if (profile.data && profile.data.status === 'inactive') {
      router.replace('/fractionalre/onboarding');
    }
  }, [profile.data]);

  if (profile.isLoading || portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Real Estate Invest" />
        <StateView kind="loading" message="Loading your portfolio…" />
      </SafeAreaView>
    );
  }

  const p = portfolio.data;
  const prof = profile.data;
  const needsKyc = prof && (!prof.kycVerified || !prof.suitabilityComplete);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Real Estate Invest"
        rightSlot={
          <Pressable hitSlop={10} onPress={() => router.push('/fractionalre/account')}>
            <UserCog size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <RiskRibbon compact />

        {/* Portfolio value hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Portfolio value</Text>
          <Text style={styles.heroValue}>{p ? formatNaira(p.totalValueKobo) : '₦0'}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroStat}>
              <Wallet size={14} color={Colors.inverseOnSurface} strokeWidth={2} />
              <Text style={styles.heroStatText}>Wallet {p ? formatNairaCompact(p.walletBalanceKobo) : '₦0'}</Text>
            </View>
            {p?.nextPayout ? (
              <View style={styles.heroStat}>
                <Calendar size={14} color={Colors.inverseOnSurface} strokeWidth={2} />
                <Text style={styles.heroStatText}>Next {formatNairaCompact(p.nextPayout.amountKobo)} · {relativeDate(p.nextPayout.dueAt)}</Text>
              </View>
            ) : null}
          </View>
          <Pressable style={styles.heroCta} onPress={() => router.push('/fractionalre/portfolio')}>
            <Text style={styles.heroCtaText}>View portfolio</Text>
            <ArrowRight size={16} color={Colors.primary} strokeWidth={2.5} />
          </Pressable>
        </View>

        {/* KYC / limit banner */}
        {needsKyc ? (
          <Pressable style={styles.kycBanner} onPress={() => router.push('/kyc')}>
            <ShieldAlert size={18} color={Colors.onWarning} strokeWidth={2} />
            <Text style={styles.kycText}>
              Complete verification to invest. {prof && !prof.kycVerified ? 'KYC required.' : 'Suitability required.'}
            </Text>
            <ChevronRight size={18} color={Colors.onWarning} strokeWidth={2} />
          </Pressable>
        ) : null}

        {/* Quick nav tiles */}
        <View style={styles.tiles}>
          <Tile icon={Compass} label="Explore" onPress={() => router.push('/fractionalre/market')} />
          <Tile icon={PieChart} label="Portfolio" onPress={() => router.push('/fractionalre/portfolio')} />
          <Tile icon={Store} label="Market" onPress={() => router.push('/fractionalre/market/listings')} />
          <Tile icon={GraduationCap} label="Learn" onPress={() => router.push('/fractionalre/learn')} />
        </View>

        {/* Featured carousel */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured opportunities</Text>
          <Pressable onPress={() => router.push('/fractionalre/market')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
          {(featured.data ?? []).slice(0, 5).map((o) => (
            <View key={o.id} style={styles.carouselItem}>
              <OpportunityCard offering={o} />
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon: Icon, label, onPress }: { icon: typeof Compass; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress}>
      <View style={styles.tileIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: {
    backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm,
  },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  heroValue: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: 4 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroStatText: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  heroCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.onPrimary, borderRadius: Radius.full, paddingVertical: 10, marginTop: Spacing.sm,
  },
  heroCtaText: { ...Typography.labelLg, color: Colors.primary },
  kycBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md,
  },
  kycText: { ...Typography.labelMd, color: Colors.onWarning, flex: 1 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between' },
  tile: { alignItems: 'center', gap: 6, flex: 1 },
  tileIcon: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },
  carousel: { gap: Spacing.md, paddingRight: Spacing.md },
  carouselItem: { width: 300 },
});
