// Bills hub. The job here is "pay a bill", and for anyone who has bought before, "pay that
// again" — so past purchases (with their provider logos) come first, then the five services.
// Search filters both. History opens the transaction list.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import { BILL_CATEGORIES } from '@/data/billPayment';
import { useRecentBillers } from '@/features/services/useRecentBillers';
import { filterServices, filterRecents, serviceRoute } from '@/features/services/billsHub';
import PayAgainRow from '@/features/services/components/PayAgainRow';
import ServiceGrid from '@/features/services/components/ServiceGrid';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { HomeMenuButton } from '@/components/HomeMenu';
import { RemoteBanner } from '@/features/media/banners';

export default function BillsScreen() {
  const [query, setQuery] = useState('');
  const recent = useRecentBillers();

  const services = useMemo(() => filterServices(BILL_CATEGORIES, query), [query]);
  const payAgain = useMemo(() => filterRecents(recent.rows, query), [recent.rows, query]);
  const searching = query.trim().length > 0;
  const nothingFound = searching && services.length === 0 && payAgain.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => goBack('/services')}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle} accessibilityRole="header">Bill Payments</Text>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => router.push('/services/transactions' as never)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Transaction history"
          >
            <Icons.History size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <RemoteBanner slug="bills-hero" priority style={styles.banner} />

        <SearchBar
          placeholder="Search biller or service"
          value={query}
          onChangeText={setQuery}
        />

        {payAgain.length > 0 && (
          <>
            <Text style={styles.sectionTitle} accessibilityRole="header">Pay again</Text>
            <PayAgainRow rows={payAgain} onPress={(r) => router.push(serviceRoute(r.serviceType) as never)} />
          </>
        )}

        {services.length > 0 && (
          <>
            <Text style={styles.sectionTitle} accessibilityRole="header">Pay a bill</Text>
            <ServiceGrid services={services} onPress={(route) => router.push(route as never)} />
          </>
        )}

        {nothingFound && (
          <Text style={styles.empty}>
            Nothing matches “{query.trim()}”. Try a service like airtime or electricity, or a provider name.
          </Text>
        )}

        {!searching && (
          <Pressable
            onPress={() => router.push('/services/beneficiaries' as never)}
            style={({ pressed }) => [styles.manageCard, shadow1, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Saved beneficiaries. Add, review and manage repeat bill payments"
          >
            <View style={styles.manageIcon}>
              <Icons.UsersRound size={22} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={styles.manageCopy}>
              <Text style={styles.manageTitle}>Saved beneficiaries</Text>
              <Text style={styles.manageSub}>Add, review and manage repeat bill payments</Text>
            </View>
            <Icons.ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(248,249,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: {
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96,
  },
  banner: { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  sectionTitle: {
    ...Typography.titleLg,
    color: Colors.onSurface,
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  empty: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
  },
  manageCard: {
    minHeight: 72,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  manageIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgTeal,
  },
  manageCopy: { flex: 1 },
  manageTitle: { ...Typography.labelLg, color: Colors.onSurface },
  manageSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
