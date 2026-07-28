import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarDays, MessageSquare, Wallet, Bell, Mail, MessageCircle, Eye, Zap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader, DoctorAvatar, RatingStars } from '@/features/telemedicine/components';
import { SectionCard, ToggleRow, InfoRow, StateView } from '@/features/doctor/components';
import { useDoctorProfile, useSettings, useUpdateSettings, useLogout } from '@/features/doctor/hooks';
import type { DoctorSettings } from '@/types/doctor';

// ── Section AC — Settings hub (AC.1-16) ───────────────────────────────────────
// EXTENDED into the full settings hub. Quick notification/channel/availability
// toggles REUSE the Phase 1 useSettings / useUpdateSettings. The hub links every
// AC sub-screen (profile / pricing / availability / bank / notifications /
// security / privacy / language+theme / devices / delete account) plus the AD
// account-status & app-status gates so reviewers can reach them. Logout uses a
// confirm before calling the shared useLogout.

export default function DoctorSettingsScreen() {
  const { data: profile, isLoading: profileLoading } = useDoctorProfile();
  const { data: settings, isLoading, isError, refetch } = useSettings();
  const update = useUpdateSettings();
  const logout = useLogout();

  const set = (patch: Partial<DoctorSettings>) => update.mutate({ settings: patch });

  const handleLogout = () => {
    Alert.alert('Log out?', 'You will need to sign in again to access your account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout.mutateAsync(undefined);
            router.replace('/(doctor)/account-status/session-expired');
          } catch {
            Alert.alert('Failed', 'Could not log out. Please try again.');
          }
        },
      },
    ]);
  };

  if ((isLoading || profileLoading) && !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Settings" />
        <StateView variant="loading" label="Loading settings" />
      </SafeAreaView>
    );
  }

  if (isError || !settings || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Settings" />
        <StateView variant="error" message="We could not load your settings." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Settings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Profile header */}
        <View style={styles.profileCard}>
          <DoctorAvatar initials={profile.initials} color={profile.avatarColor} size={64} online={profile.isOnline} />
          <View style={styles.profileBody}>
            <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
            <Text style={styles.title} numberOfLines={1}>{profile.title}</Text>
            <RatingStars rating={profile.rating} reviewCount={profile.reviewCount} />
          </View>
        </View>

        <SectionCard title="Account" style={styles.card}>
          <InfoRow label="Email" value={profile.email} />
          <InfoRow label="Phone" value={profile.phone} />
          <InfoRow label="MDCN" value={profile.mdcnNumber} />
          <InfoRow label="Verification" value={profile.verification} valueColor={profile.verification === 'approved' ? Colors.teal : Colors.secondary} />
        </SectionCard>

        <Text style={styles.groupTitle}>Quick toggles</Text>
        <View style={styles.toggleGroup}>
          <ToggleRow icon={CalendarDays} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Appointments" value={settings.notifyAppointments} onValueChange={(v) => set({ notifyAppointments: v })} />
          <ToggleRow icon={MessageSquare} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Messages" value={settings.notifyMessages} onValueChange={(v) => set({ notifyMessages: v })} />
          <ToggleRow icon={Wallet} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Payouts" value={settings.notifyPayouts} onValueChange={(v) => set({ notifyPayouts: v })} />
          <ToggleRow icon={Bell} label="Push notifications" value={settings.pushEnabled} onValueChange={(v) => set({ pushEnabled: v })} />
          <ToggleRow icon={Mail} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Email" value={settings.emailEnabled} onValueChange={(v) => set({ emailEnabled: v })} />
          <ToggleRow icon={MessageCircle} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="SMS" value={settings.smsEnabled} onValueChange={(v) => set({ smsEnabled: v })} />
          <ToggleRow icon={Eye} label="Show online status" value={settings.showOnlineStatus} onValueChange={(v) => set({ showOnlineStatus: v })} />
          <ToggleRow icon={Zap} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Auto-accept instant consults" value={settings.autoAcceptInstant} onValueChange={(v) => set({ autoAcceptInstant: v })} />
        </View>

        <Text style={styles.groupTitle}>Profile &amp; practice</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="UserCog" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Edit professional profile" onPress={() => router.push('/(doctor)/profile/setup')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Eye" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Preview profile" onPress={() => router.push('/(doctor)/profile/setup/preview')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Coins" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Edit consultation pricing" onPress={() => router.push('/(doctor)/profile/setup/pricing')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Building2" label="Edit availability" onPress={() => router.push('/(doctor)/availability')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Landmark" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Edit bank account" onPress={() => router.push('/(doctor)/earnings/bank-account')} />
        </View>

        <Text style={styles.groupTitle}>App settings</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="Bell" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Notification settings" onPress={() => router.push('/(doctor)/notifications/preferences')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Lock" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Security" onPress={() => router.push('/(doctor)/settings/security')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="ShieldCheck" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Privacy" onPress={() => router.push('/(doctor)/compliance/privacy')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Languages" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Language & theme" onPress={() => router.push('/(doctor)/settings/app-preferences')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Smartphone" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Device management" onPress={() => router.push('/(doctor)/settings/devices')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="ShieldAlert" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Compliance" onPress={() => router.push('/(doctor)/compliance')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="LifeBuoy" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Help & support" onPress={() => router.push('/(doctor)/support')} />
        </View>

        <Text style={styles.groupTitle}>Account status &amp; gates</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="ShieldCheck" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Verification status" onPress={() => router.push('/(doctor)/signup/pending')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="UserCheck" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Account status" onPress={() => router.push('/(doctor)/account-status')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="ServerCog" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="App status (maintenance / update)" onPress={() => router.push('/(doctor)/app-status')} />
        </View>

        <Text style={styles.groupTitle}>Danger zone</Text>
        <View style={styles.menu}>
          <ProfileMenuItem icon="LogOut" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Log out" showChevron={false} onPress={handleLogout} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Trash2" danger label="Delete account" onPress={() => router.push('/(doctor)/settings/delete-account')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  profileBody: { flex: 1, gap: 4 },
  name:        { ...Typography.titleLg, color: Colors.onSurface },
  title:       { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card:        { marginBottom: Spacing.md },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  toggleGroup: { gap: Spacing.sm, marginBottom: Spacing.md },
  menu:        { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  divider:     { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
});
