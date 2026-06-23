// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDashboard } from '@/api/dashboard.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';

// ─── Quick wallet actions ────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Fund',    icon: 'add-circle-outline',        route: '/wallet',       color: '#00B894' },
  { label: 'Send',    icon: 'arrow-up-circle-outline',   route: '/transfers',    color: '#0051d5' },
  { label: 'History', icon: 'receipt-outline',           route: '/transactions', color: '#6C5CE7' },
  { label: 'KYC',     icon: 'shield-checkmark-outline',  route: '/kyc',          color: '#F39C12' },
];

// ─── Lifestyle & marketplace services ────────────────────────────────────────
const SERVICES = [
  { label: 'Food',         icon: 'fast-food-outline',           route: '/restaurant',            color: '#FF6B35' },
  { label: 'Health',       icon: 'medical-outline',             route: '/telemedicine',          color: '#00B894' },
  { label: 'Pharmacy',     icon: 'medkit-outline',              route: '/telemedicine/pharmacy', color: '#059669' },
  { label: 'Transport',    icon: 'car-outline',                 route: '/transport',             color: '#0051d5' },
  { label: 'Events',       icon: 'calendar-outline',            route: '/events',                color: '#C5A059' },
  { label: 'Crowdfund',    icon: 'heart-outline',               route: '/crowdfunding',          color: '#E84393' },
  { label: 'Groups',       icon: 'people-outline',              route: '/groups',                color: '#6C5CE7' },
  { label: 'Invest',       icon: 'trending-up-outline',         route: '/(tabs)/invest',         color: '#F59E0B' },
  { label: 'Vote',         icon: 'star-outline',                route: '/(tabs)/vote',           color: '#C5A059' },
  { label: 'Estate',       icon: 'home-outline',                route: '/estate',                color: '#10B981' },
  { label: 'Disputes',     icon: 'flag-outline',                route: '/disputes',              color: '#dc2626' },
  { label: 'Support',      icon: 'chatbubble-ellipses-outline', route: '/support',               color: '#74B9FF' },
  { label: 'More',         icon: 'grid-outline',                route: '/(tabs)/more',           color: '#94a3b8' },
];

// ─── Bill payments ────────────────────────────────────────────────────────────
const BILLS = [
  { label: 'Airtime',      icon: 'call-outline',   route: '/airtime' },
  { label: 'Data',         icon: 'wifi-outline',   route: '/data' },
  { label: 'Electricity',  icon: 'flash-outline',  route: '/electricity' },
  { label: 'Cable TV',     icon: 'tv-outline',     route: '/cable' },
];

export default function HomeScreen() {
  const router = useRouter();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  if (dashboard.isLoading) return <AppLoader />;

  const balance    = dashboard.data?.wallet?.balance ?? 0;
  const currency   = dashboard.data?.wallet?.currency ?? 'NGN';
  const userName   = (dashboard.data?.user?.fullName || 'there').split(' ')[0];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={dashboard.isRefetching} onRefresh={dashboard.refetch} />
        }
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good day, {userName} 👋</Text>
            <Text style={styles.subGreeting}>Paymax Super App</Text>
          </View>
          <Pressable
            onPress={() => router.push('/support')}
            style={styles.notifBtn}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.neutral.white} />
          </Pressable>
        </View>

        {/* ── Wallet card ─────────────────────────────────────────────────── */}
        <View style={styles.walletCard}>
          <View style={styles.walletGlow} />
          <Text style={styles.walletLabel}>Total Balance</Text>
          <Text style={styles.walletBalance}>{formatCurrency(balance, currency)}</Text>

          {/* Quick action row */}
          <View style={styles.quickRow}>
            {QUICK_ACTIONS.map((a) => (
              <Pressable
                key={a.label}
                style={({ pressed }) => [styles.quickItem, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(a.route as never)}
              >
                <View style={[styles.quickIconWrap, { backgroundColor: a.color + '25' }]}>
                  <Ionicons name={a.icon as never} size={20} color={a.color} />
                </View>
                <Text style={styles.quickLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Pay Bills ───────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pay Bills</Text>
          <View style={styles.billsRow}>
            {BILLS.map((b) => (
              <Pressable
                key={b.label}
                style={({ pressed }) => [styles.billItem, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(b.route as never)}
              >
                <View style={styles.billIcon}>
                  <Ionicons name={b.icon as never} size={20} color={colors.primary.DEFAULT} />
                </View>
                <Text style={styles.billLabel}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── All Services grid ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All Services</Text>
          <View style={styles.servicesGrid}>
            {SERVICES.map((s) => (
              <Pressable
                key={s.label}
                style={({ pressed }) => [styles.serviceItem, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(s.route as never)}
              >
                <View style={[styles.serviceIcon, { backgroundColor: s.color + '18' }]}>
                  <Ionicons name={s.icon as never} size={26} color={s.color} />
                </View>
                <Text style={styles.serviceLabel}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Voting banner ───────────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.voteBanner, pressed && { opacity: 0.9 }]}
          onPress={() => router.push('/(tabs)/vote' as never)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.voteBannerTag}>LIVE NOW</Text>
            <Text style={styles.voteBannerTitle}>Voting Contests</Text>
            <Text style={styles.voteBannerSub}>Vote for your favourite contestant</Text>
          </View>
          <View style={styles.voteBannerIcon}>
            <Ionicons name="trophy" size={32} color={colors.gold.DEFAULT} />
          </View>
        </Pressable>

        {/* ── Recent transactions ─────────────────────────────────────────── */}
        {dashboard.data?.recentTransactions?.length ? (
          <View style={[styles.section, { marginBottom: 24 }]}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <Pressable onPress={() => router.push('/transactions' as never)}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <View style={styles.txCard}>
              {dashboard.data.recentTransactions.slice(0, 4).map((tx, idx, arr) => (
                <Pressable
                  key={tx.id}
                  style={[styles.txRow, idx < arr.length - 1 && styles.txBorder]}
                  onPress={() => router.push(`/transactions/${tx.id}` as never)}
                >
                  <View style={[
                    styles.txIcon,
                    { backgroundColor: tx.type === 'CREDIT' ? '#00B89420' : '#dc262620' }
                  ]}>
                    <Ionicons
                      name={tx.type === 'CREDIT' ? 'arrow-down' : 'arrow-up'}
                      size={16}
                      color={tx.type === 'CREDIT' ? '#00B894' : '#dc2626'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txRef} numberOfLines={1}>{tx.reference || 'Transaction'}</Text>
                    <Text style={styles.txDate}>{new Date(tx.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.txAmount, { color: tx.type === 'CREDIT' ? '#00B894' : '#dc2626' }]}>
                    {tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount, currency)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary.DEFAULT },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: colors.primary.DEFAULT,
  },
  greeting:    { fontSize: 20, fontWeight: '700', color: colors.neutral.white },
  subGreeting: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  notifBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Wallet card
  walletCard: {
    marginHorizontal: 20,
    marginBottom: 4,
    borderRadius: 20,
    padding: 22,
    backgroundColor: colors.primary.dark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  walletGlow: {
    position: 'absolute', top: -40, right: -40,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.secondary.DEFAULT, opacity: 0.2,
  },
  walletLabel:   { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  walletBalance: { fontSize: 30, fontWeight: '800', color: colors.neutral.white, marginBottom: 18 },

  // Quick actions (inside wallet card)
  quickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quickItem: { alignItems: 'center', gap: 6, flex: 1 },
  quickIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  // Section containers
  section: { paddingHorizontal: 20, paddingTop: 20, backgroundColor: colors.neutral.background },
  sectionRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.neutral.text, marginBottom: 14 },
  seeAll:      { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600' },

  // Bills row
  billsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  billItem: { alignItems: 'center', gap: 8, flex: 1 },
  billIcon: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  billLabel: { fontSize: 11, color: colors.neutral.textMuted, fontWeight: '500' },

  // All services grid (4 columns)
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  serviceItem: {
    width: '22%',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  serviceIcon: {
    width: 58, height: 58, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  serviceLabel: { fontSize: 11, color: colors.neutral.text, fontWeight: '500', textAlign: 'center' },

  // Voting banner
  voteBanner: {
    marginHorizontal: 20, marginTop: 20, borderRadius: 18,
    padding: 20, backgroundColor: colors.primary.dark,
    flexDirection: 'row', alignItems: 'center',
  },
  voteBannerTag:   { fontSize: 10, fontWeight: '800', color: colors.gold.DEFAULT, letterSpacing: 1.5, marginBottom: 4 },
  voteBannerTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.white },
  voteBannerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  voteBannerIcon: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.gold.container,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 12,
  },

  // Transactions
  txCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  txRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  txBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  txIcon:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  txRef:    { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  txDate:   { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '700' },
});
