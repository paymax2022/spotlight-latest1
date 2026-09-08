import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import { BILL_CATEGORIES } from '@/data/billPayment';
import { useBillerStore } from '@/features/services/billerStore';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { HomeMenuButton } from '@/components/HomeMenu';

function DynamicIcon({ name, size = 24, color }: { name: string; size?: number; color: string }) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <IconComponent size={size} color={color} strokeWidth={2} />;
}

export default function BillsScreen() {
  const recentBillers = useBillerStore((s) => s.billers);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services')} style={styles.iconButton}>
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Bill Payments</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable style={styles.iconButton}>
            <Icons.History size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient
          colors={[Colors.primary, Colors.secondaryContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <Text style={styles.heroEyebrow}>Paymax Bills Hub</Text>
          <Text style={styles.heroTitle}>Pay bills instantly</Text>
          <Text style={styles.heroSubtitle}>Airtime, data, electricity, cable TV, and education payments in one secure flow.</Text>
        </LinearGradient>

        <SearchBar placeholder="Search biller or service" />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Choose Service</Text>
          <Text style={styles.sectionAction}>Secure</Text>
        </View>

        <View style={styles.categoryGrid}>
          {BILL_CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => router.push(category.route as never)}
              style={[styles.categoryCard, shadow1]}
            >
              <View style={[styles.categoryIcon, { backgroundColor: category.bg }]}>
                <DynamicIcon name={category.icon} color={category.accent} />
              </View>
              <Text style={styles.categoryTitle}>{category.label}</Text>
              <Icons.ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Billers</Text>
          <Pressable onPress={() => router.push('/services/beneficiaries' as never)}>
            <Text style={styles.sectionAction}>Manage</Text>
          </Pressable>
        </View>

        <View style={[styles.recentCard, shadow1]}>
          {recentBillers.map((biller, index) => (
            <View key={biller.id}>
              <View style={styles.recentRow}>
                <View style={[styles.recentIcon, { backgroundColor: biller.bg }]}>
                  <DynamicIcon name={biller.icon} color={biller.accent} size={20} />
                </View>
                <View style={styles.recentCopy}>
                  <Text style={styles.recentTitle}>{biller.title}</Text>
                  <Text style={styles.recentSubtitle}>{biller.subtitle}</Text>
                </View>
                {biller.amount ? <Text style={styles.recentAmount}>{biller.amount}</Text> : null}
              </View>
              {index < recentBillers.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/services/beneficiaries' as never)}
          style={[styles.manageCard, shadow1]}
        >
          <View style={[styles.categoryIcon, { backgroundColor: Colors.iconBgTeal }]}>
            <DynamicIcon name="UsersRound" color={Colors.teal} />
          </View>
          <View style={styles.recentCopy}>
            <Text style={styles.recentTitle}>Saved Beneficiaries</Text>
            <Text style={styles.recentSubtitle}>Add, review, and manage repeat bill payments</Text>
          </View>
          <Icons.ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        </Pressable>
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
  hero: {
    minHeight: 172,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    justifyContent: 'flex-end',
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
  },
  heroEyebrow: { ...Typography.labelSm, color: Colors.inverseOnSurface, opacity: 0.9 },
  heroTitle: { ...Typography.headlineLgMobile, color: Colors.onPrimary, marginTop: Spacing.xs },
  heroSubtitle: { ...Typography.bodySm, color: Colors.inverseOnSurface, marginTop: Spacing.xs },
  sectionHeader: {
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionAction: { ...Typography.labelMd, color: Colors.secondary },
  categoryGrid: {
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.md,
  },
  categoryCard: {
    minHeight: 82,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitle: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  recentCard: {
    marginHorizontal: Spacing.containerMargin,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  manageCard: {
    minHeight: 76,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  recentIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentCopy: { flex: 1 },
  recentTitle: { ...Typography.labelMd, color: Colors.onSurface },
  recentSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  recentAmount: { ...Typography.labelMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
