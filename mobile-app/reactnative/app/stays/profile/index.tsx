import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  User, Mail, Phone, Globe, ShieldCheck, Users, Wallet, Award, Star, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useGuestProfile } from '@/features/stays/hooks';
import { useLoyaltyStatus } from '@/features/stays/reviews';
import { StaysColors } from '@/features/stays/constants/stays.constants';

export default function StaysProfileScreen() {
  const profile = useGuestProfile();
  const loyalty = useLoyaltyStatus();

  if (profile.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Profile" />
        <StateView kind="loading" message="Loading your profile…" />
      </SafeAreaView>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Profile" />
        <StateView kind="error" title="Couldn't load profile" actionLabel="Retry" onAction={() => profile.refetch()} />
      </SafeAreaView>
    );
  }

  const p = profile.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile" subtitle="Personal details" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.avatar}><User size={28} color={Colors.primary} /></View>
          <Text style={styles.name}>{p.fullName}</Text>
          <View style={styles.kycChip}>
            <ShieldCheck size={12} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.kycText}>KYC Tier {p.kycTier} verified</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Detail icon={<Mail size={16} color={Colors.onSurfaceVariant} />} label="Email" value={p.email} />
          <Detail icon={<Phone size={16} color={Colors.onSurfaceVariant} />} label="Phone" value={p.phone} />
          <Detail icon={<Globe size={16} color={Colors.onSurfaceVariant} />} label="Country" value={p.country} />
        </View>

        {loyalty.data ? (
          <Pressable style={styles.loyaltyCard} onPress={() => router.push('/stays/loyalty')}>
            <View style={styles.loyaltyIcon}><Award size={22} color={Colors.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.loyaltyTitle}>{loyalty.data.currentTierName}</Text>
              <Text style={styles.loyaltySub}>{loyalty.data.discountPct}% off eligible rates · {loyalty.data.staysCompleted} stays</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        ) : null}

        <View style={styles.menu}>
          <MenuRow icon={<Users size={18} color={Colors.onSurface} />} label="Travel documents & saved guests" onPress={() => router.push('/stays/profile/saved-guests')} />
          <MenuRow icon={<Wallet size={18} color={Colors.onSurface} />} label="Wallet & payments" onPress={() => router.push('/stays/profile/wallet-overview')} />
          <MenuRow icon={<Star size={18} color={Colors.gold} />} label="My reviews" onPress={() => router.push('/stays/reviews/mine')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailVal}>{value}</Text>
      </View>
    </View>
  );
}

function MenuRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={styles.menuIcon}>{icon}</View>
      <Text style={styles.menuLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  kycChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 4 },
  kycText: { ...Typography.labelSm, color: StaysColors.ok, fontWeight: '700' as const },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.md },
  detail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  detailIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  detailLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  detailVal: { ...Typography.bodyMd, color: Colors.onSurface },
  loyaltyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md },
  loyaltyIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  loyaltyTitle: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  loyaltySub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  menu: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  menuIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const, flex: 1 },
});
