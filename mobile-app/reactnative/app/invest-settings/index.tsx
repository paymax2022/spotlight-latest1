import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import MenuRow from '@/features/investsettings/components/MenuRow';
import { useInvestProfile } from '@/features/investsettings/hooks/useSettings';
import { KYC_TIER_META, RISK_CATEGORY_META } from '@/features/investsettings/constants/settings.constants';

export default function InvestSettingsHomeScreen() {
  const { data: profile } = useInvestProfile();
  const kycLabel = profile ? KYC_TIER_META[profile.kycTier].label : undefined;
  const riskLabel = profile ? RISK_CATEGORY_META[profile.riskCategory].label : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest settings" subtitle="Account, security & support" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile summary card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(profile?.name ?? 'PX').slice(0, 1)}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{profile?.name ?? 'Your account'}</Text>
            <Text style={styles.sub} numberOfLines={1}>{profile?.email ?? '—'}</Text>
          </View>
        </View>

        <SectionHeader title="Account" style={styles.sectionHeader} />
        <View style={styles.group}>
          <MenuRow icon="User" iconColor={Colors.primary} bgColor={Colors.iconBgPurple}
            label="Profile" value={profile?.name} onPress={() => router.push('/invest-settings/profile')} />
          <MenuRow icon="BadgeCheck" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue}
            label="KYC details" value={kycLabel} onPress={() => router.push('/invest-settings/profile')} />
          <MenuRow icon="Gauge" iconColor={Colors.teal} bgColor={Colors.iconBgTeal}
            label="Risk profile" value={riskLabel} onPress={() => router.push('/invest-settings/profile')} />
          <MenuRow icon="Landmark" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue}
            label="Linked banks" onPress={() => router.push('/invest-settings/banks')} />
        </View>

        <SectionHeader title="Money" style={styles.sectionHeader} />
        <View style={styles.group}>
          <MenuRow icon="Percent" iconColor={Colors.primary} bgColor={Colors.iconBgPurple}
            label="Fee schedule" onPress={() => router.push('/invest-settings/fees')} />
          <MenuRow icon="FileText" iconColor={Colors.primary} bgColor={Colors.iconBgPurple}
            label="Statements & tax docs" onPress={() => router.push('/invest-settings/statements')} />
        </View>

        <SectionHeader title="Security & support" style={styles.sectionHeader} />
        <View style={styles.group}>
          <MenuRow icon="ShieldCheck" iconColor={Colors.teal} bgColor={Colors.iconBgTeal}
            label="Security center" onPress={() => router.push('/invest-settings/security')} />
          <MenuRow icon="LifeBuoy" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue}
            label="Help & support" onPress={() => router.push('/invest-settings/support')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryFixed,
  },
  avatarText: { ...Typography.titleLg, color: Colors.primary },
  flex: { flex: 1 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionHeader: { marginTop: Spacing.sm },
  group: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
});
