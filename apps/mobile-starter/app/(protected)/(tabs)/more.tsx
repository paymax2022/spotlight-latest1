// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMe } from '@/api/auth.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { useAuthStore } from '@/store/authStore';

type MenuItem = {
  label: string;
  icon: string;
  route?: string;
  action?: () => void;
  badge?: string;
  color?: string;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

export default function MoreScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useQuery({ queryKey: ['me'], queryFn: getMe });

  if (user.isLoading) return <AppLoader />;

  const sections: MenuSection[] = [
    {
      title: 'Marketplace',
      items: [
        { label: 'Food & Restaurant',   icon: 'fast-food-outline',           route: '/restaurant',              color: '#FF6B35' },
        { label: 'Health / Telemedicine', icon: 'medical-outline',            route: '/telemedicine',            color: '#00B894' },
        { label: 'Pharmacy',            icon: 'medkit-outline',               route: '/telemedicine/pharmacy',   color: '#059669' },
        { label: 'Transport & Rides',   icon: 'car-outline',                  route: '/transport',               color: '#0051d5' },
        { label: 'Events & Tickets',    icon: 'calendar-outline',             route: '/events',                  color: '#C5A059' },
        { label: 'Crowdfunding',        icon: 'heart-outline',                route: '/crowdfunding',            color: '#E84393' },
        { label: 'Groups & Savings',    icon: 'people-outline',               route: '/groups',                  color: '#6C5CE7' },
        { label: 'Estate Management',   icon: 'home-outline',                 route: '/estate',                  color: '#10B981' },
        { label: 'Invest',              icon: 'trending-up-outline',          route: '/(tabs)/invest',           color: '#F59E0B' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Wallet & Topup',      icon: 'wallet-outline',               route: '/wallet',                  color: colors.primary.DEFAULT },
        { label: 'Send Money',          icon: 'arrow-up-circle-outline',      route: '/transfers',               color: '#00CEC9' },
        { label: 'Transactions',        icon: 'list-outline',                 route: '/transactions',            color: colors.primary.DEFAULT },
        { label: 'KYC Verification',    icon: 'shield-checkmark-outline',     route: '/kyc',                     color: '#F39C12' },
        { label: 'Airtime',             icon: 'call-outline',                 route: '/airtime',                 color: '#64748b' },
        { label: 'Data',                icon: 'wifi-outline',                 route: '/data',                    color: '#64748b' },
        { label: 'Electricity',         icon: 'flash-outline',                route: '/electricity',             color: '#64748b' },
        { label: 'Cable TV',            icon: 'tv-outline',                   route: '/cable',                   color: '#64748b' },
      ],
    },
    {
      title: 'Voting',
      items: [
        { label: 'Live Contests',       icon: 'star-outline',                 route: '/(tabs)/vote',             color: '#C5A059' },
        { label: 'Vote & Pay',          icon: 'trophy-outline',               route: '/(tabs)/pay',              color: '#C5A059' },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Disputes',            icon: 'flag-outline',                 route: '/disputes',                color: '#dc2626' },
        { label: 'Support',             icon: 'chatbubble-ellipses-outline',  route: '/support',                 color: '#0051d5' },
        { label: 'Sign Out',            icon: 'log-out-outline',              action: logout,                    color: '#dc2626' },
      ],
    },
  ];

  const fullName = user.data?.fullName || 'Paymax User';
  const email = user.data?.email || '';
  const kycStatus = user.data?.kycStatus || 'none';

  const kycBadgeColor =
    kycStatus === 'verified' ? '#00B894' : kycStatus === 'pending' ? '#F39C12' : '#dc2626';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{fullName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{fullName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
          <View style={[styles.kycBadge, { backgroundColor: kycBadgeColor + '20' }]}>
            <Text style={[styles.kycBadgeText, { color: kycBadgeColor }]}>
              {kycStatus === 'verified' ? '✓ Verified' : kycStatus === 'pending' ? 'Pending' : 'Unverified'}
            </Text>
          </View>
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.card}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    styles.menuItem,
                    idx < section.items.length - 1 && styles.menuItemBorder,
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={() => {
                    if (item.action) { item.action(); return; }
                    if (item.route) router.push(item.route as never);
                  }}
                >
                  <View style={[styles.menuItemIcon, { backgroundColor: (item.color || colors.primary.DEFAULT) + '15' }]}>
                    <Ionicons name={item.icon as never} size={20} color={item.color || colors.primary.DEFAULT} />
                  </View>
                  <Text style={styles.menuItemLabel}>{item.label}</Text>
                  {item.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.version}>Paymax v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 20,
    padding: 16,
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: colors.neutral.white },
  profileName: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  profileEmail: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  kycBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  kycBadgeText: { fontSize: 12, fontWeight: '600' },
  section: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.neutral.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  menuItemPressed: { backgroundColor: colors.neutral.surfaceAlt },
  menuItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemLabel: { flex: 1, fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  badge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  version: { textAlign: 'center', color: colors.neutral.placeholder, fontSize: 12, marginVertical: 20 },
});
