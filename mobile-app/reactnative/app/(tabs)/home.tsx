import React from 'react';
import { ScrollView, View, Text, StyleSheet, Platform, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, ArrowDown, RefreshCw } from 'lucide-react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AppHeader from '@/components/AppHeader';
import SearchBar from '@/components/SearchBar';
import BalanceCard from '@/components/BalanceCard';
import SectionHeader from '@/components/SectionHeader';
import ModuleGrid from '@/components/ModuleGrid';
import FeaturedServiceCard from '@/components/FeaturedServiceCard';
import PromoBanner from '@/components/PromoBanner';
import RecentActivityCard, { Activity } from '@/components/RecentActivityCard';
import { FeaturedHomeSection } from '@/features/featured/components';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { Typography } from '@/constants/typography';
import { SERVICE_MODULES, FEATURED_SERVICES, QUICK_ACTIONS } from '@/constants/modules';
import { shadow1 } from '@/constants/shadows';
import { getDashboard } from '@/api/dashboard.api';
import { Transaction } from '@/types/transaction';

const QUICK_ACTION_ICONS: Record<string, React.ReactNode> = {
  add:      <Plus      size={20} color={Colors.onPrimary} strokeWidth={2} />,
  send:     <Send      size={20} color={Colors.onPrimary} strokeWidth={2} />,
  withdraw: <ArrowDown size={20} color={Colors.onPrimary} strokeWidth={2} />,
  exchange: <RefreshCw size={20} color={Colors.onPrimary} strokeWidth={2} />,
};

const SERVICE_ICON_MAP: Record<string, string> = {
  AIRTIME:     'Smartphone',
  DATA:        'Wifi',
  ELECTRICITY: 'Zap',
  CABLE_TV:    'Tv',
};

const SERVICE_COLOR_MAP: Record<string, { iconColor: string; bgColor: string }> = {
  AIRTIME:     { iconColor: Colors.primary, bgColor: Colors.iconBgPurple },
  DATA:        { iconColor: Colors.secondary, bgColor: Colors.iconBgBlue },
  ELECTRICITY: { iconColor: '#EAB308', bgColor: 'rgba(234,179,8,0.10)' },
  CABLE_TV:    { iconColor: Colors.teal, bgColor: Colors.iconBgTeal },
};

function txToActivity(tx: Transaction): Activity {
  const svc  = tx.serviceType ?? 'AIRTIME';
  const clr  = SERVICE_COLOR_MAP[svc] ?? { iconColor: Colors.primary, bgColor: Colors.iconBgPurple };
  const isCredit = tx.status === 'REFUNDED' || tx.status === 'REVERSED';
  return {
    id:        tx.id,
    title:     tx.productName ?? tx.providerName ?? svc,
    subtitle:  tx.customerIdentifier,
    amount:    isCredit ? tx.totalAmount : -tx.totalAmount,
    type:      isCredit ? 'credit' : 'debit',
    icon:      SERVICE_ICON_MAP[svc] ?? 'Circle',
    iconColor: clr.iconColor,
    bgColor:   clr.bgColor,
    date:      new Date(tx.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
  };
}

const FINANCIAL = SERVICE_MODULES.filter((m) => m.category === 'financial');
const UTILITY   = SERVICE_MODULES.filter((m) => m.category === 'utility');
const LIFESTYLE = SERVICE_MODULES.filter((m) => m.category === 'lifestyle');
// Invest & grow — stocks, crypto, real-estate, Spotlight Wealth, and Invest AI
// (the AI trading/education assistant). Excludes 'academy' (StudyHub).
const INVEST    = SERVICE_MODULES.filter((m) => m.category === 'investment' && m.id !== 'academy');

function SubCategoryLabel({ label }: { label: string }) {
  return (
    <View style={styles.subCatRow}>
      <View style={styles.subCatBar} />
      <Text style={styles.subCatText}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const [search, setSearch] = React.useState('');

  const runSearch = (text: string) => {
    const q = text.trim();
    if (!q) return;
    router.push({ pathname: '/(tabs)/services', params: { q } });
  };

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  getDashboard,
    retry: (failureCount, err) => {
      // Don't retry auth failures — redirect instead.
      if (err instanceof Error && err.message === 'Not authenticated') return false;
      return failureCount < 2;
    },
  });

  // Redirect to login on auth failure (session expired / not logged in).
  React.useEffect(() => {
    if (error instanceof Error && error.message === 'Not authenticated') {
      router.replace('/(auth)/login');
    }
  }, [error]);

  const balance  = data?.wallet.balance ?? 0;
  const userName = data?.user.fullName?.split(' ')[0] ?? 'there';
  const recent   = (data?.recentTransactions ?? []).slice(0, 5).map(txToActivity);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        <AppHeader name={userName} notifCount={0} />
        <SearchBar value={search} onChangeText={setSearch} onSubmit={runSearch} />

        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not load dashboard. Pull down to retry.</Text>
          </View>
        ) : null}

        <BalanceCard
          balance={balance}
          currency="NGN"
          quickActions={QUICK_ACTIONS.map((qa) => ({
            id:      qa.id,
            label:   qa.label,
            icon:    QUICK_ACTION_ICONS[qa.id],
            onPress: () => { try { router.push(qa.route as never); } catch {} },
          }))}
        />

        <SectionHeader title="Explore Services" actionLabel="View All" onAction={() => router.push('/(tabs)/services')} />

        <View style={[styles.servicesCard, shadow1]}>
          <SubCategoryLabel label="Financial" />
          <ModuleGrid modules={FINANCIAL} />
          <View style={styles.divider} />
          <SubCategoryLabel label="Utility" />
          <ModuleGrid modules={UTILITY} />
          <View style={styles.divider} />
          <SubCategoryLabel label="Lifestyle" />
          <ModuleGrid modules={LIFESTYLE} />
          <View style={styles.divider} />
          <SubCategoryLabel label="Invest & Grow" />
          <ModuleGrid modules={INVEST} />
        </View>

        <SectionHeader title="Featured Services" style={{ marginTop: Spacing.lg }} />
        {FEATURED_SERVICES.map((s) => (
          <FeaturedServiceCard
            key={s.id}
            title={s.title}
            subtitle={s.subtitle}
            icon={s.icon}
            iconColor={s.iconColor}
            bgColor={s.bgColor}
            onPress={() => { try { router.push(s.route as never); } catch {} }}
          />
        ))}

        <PromoBanner
          title="Win with Spotlight Contest"
          subtitle="Showcase your talent and win prizes"
          cta="Apply Now"
          badge="NEW"
          onPress={() => { try { router.push('/voting' as never); } catch {} }}
        />

        {/* Featured Placement — dynamic sponsored content fed by the landing
            resolver (hero + carousel + grid). Renders nothing when empty, so
            existing home content is unaffected. */}
        <FeaturedHomeSection />

        {/* Merchant entry point into the Featured Placement booking wizard. */}
        <PromoBanner
          title="Promote your business"
          subtitle="Feature your listing on the home screen"
          cta="Get started"
          badge="ADS"
          onPress={() => { try { router.push('/featured/promotions' as never); } catch {} }}
        />

        {recent.length > 0 ? (
          <>
            <SectionHeader
              title="Recent Activity"
              actionLabel="See all"
              onAction={() => router.push('/services/transactions' as never)}
            />
            <View style={[styles.activityCard, shadow1]}>
              {recent.map((a, i) => (
                <View key={a.id}>
                  <RecentActivityCard activity={a} />
                  {i < recent.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: Platform.OS === 'ios' ? 100 : 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingBottom: Spacing.xl },
  loader:  { paddingVertical: Spacing.xl, alignItems: 'center' },
  errorBox:{ marginHorizontal: Spacing.containerMargin, padding: Spacing.md, backgroundColor: 'rgba(220,38,38,0.06)', borderRadius: Radius.lg, marginBottom: Spacing.md },
  errorText:{ ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  servicesCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    marginHorizontal: Spacing.containerMargin,
    marginBottom:    Spacing.lg,
    paddingVertical: Spacing.md,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
  },
  subCatRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  subCatBar: { width: 3, height: 16, borderRadius: Radius.full, backgroundColor: Colors.primary },
  subCatText:{ ...Typography.labelMd, color: Colors.onSurface },
  divider:   { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md, marginHorizontal: Spacing.md },
  activityCard: {
    backgroundColor:  Colors.surfaceContainerLowest,
    borderRadius:     Radius.xl,
    marginHorizontal: Spacing.containerMargin,
    paddingHorizontal: Spacing.md,
    paddingVertical:  Spacing.sm,
    borderWidth:      1,
    borderColor:      Colors.surfaceContainerHigh,
    marginBottom:     Spacing.lg,
  },
});
