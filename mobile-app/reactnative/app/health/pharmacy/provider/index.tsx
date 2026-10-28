import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ShoppingBag, FileCheck, Boxes, Bell, ClipboardList, Wallet, Star, Stethoscope, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { getMyPharmacyProvider } from '@/features/health/pharmacy/api';

// Owner-only pharmacy management. Visible only to an APPROVED pharmacy owner; the
// provider screens re-check ownership on the server for every action.
const TILES = [
  { route: '/health/pharmacy/provider/orders', label: 'Orders', sub: 'Fulfil and dispatch customer orders', icon: ShoppingBag },
  { route: '/health/pharmacy/provider/rx-verify', label: 'Prescriptions', sub: 'Verify uploaded prescriptions', icon: FileCheck },
  { route: '/health/pharmacy/provider/catalog', label: 'Catalog & stock', sub: 'Products, prices and stock levels', icon: Boxes },
  { route: '/health/pharmacy/provider/stock-alerts', label: 'Stock alerts', sub: 'Low and out-of-stock items', icon: Bell },
  { route: '/health/pharmacy/provider/controlled-log', label: 'Controlled drug log', sub: 'Register of controlled substances', icon: ClipboardList },
  { route: '/health/pharmacy/provider/earnings', label: 'Earnings', sub: 'Balance, pending and payouts', icon: Wallet },
  { route: '/health/pharmacy/provider/reviews', label: 'Reviews', sub: 'What customers say about you', icon: Star },
  { route: '/health/pharmacy/provider/consult', label: 'Pharmacist consults', sub: 'Patient questions and advice', icon: Stethoscope },
] as const;

export default function PharmacyProviderDashboard() {
  const status = useQuery({
    queryKey: ['health', 'pharmacy', 'my-provider'],
    queryFn: getMyPharmacyProvider,
    staleTime: 60_000,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pharmacy dashboard" subtitle="Manage your pharmacy" showBack />
      {status.isLoading ? (
        <StateView kind="loading" message="Checking your access…" />
      ) : status.isError ? (
        <StateView kind="error" title="Couldn't check access" actionLabel="Retry" onAction={() => status.refetch()} />
      ) : !status.data?.isOwner ? (
        <StateView
          kind="empty"
          icon="ShieldCheck"
          title="Owner access only"
          message="This dashboard opens once your pharmacy application is approved."
          actionLabel="Pharmacy onboarding"
          onAction={() => router.replace('/health/pharmacy/provider/onboarding')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <Pressable
                key={t.route}
                style={styles.tile}
                onPress={() => router.push(t.route as never)}
                accessibilityLabel={t.label}
              >
                <View style={styles.iconBox}>
                  <Icon size={20} color={Colors.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{t.label}</Text>
                  <Text style={styles.sub}>{t.sub}</Text>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  tile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
