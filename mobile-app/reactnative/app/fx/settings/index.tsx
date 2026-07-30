import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import StateView from '@/components/StateView';
import { useSettings } from '@/features/fx/hooks/useFxAccount';
import { CURRENCIES } from '@/features/fx/constants/fx.constants';

export default function FxSettingsScreen() {
  const { data, isLoading } = useSettings();

  const confirmLogout = () => Alert.alert('Log out', 'Log out of Spotlight?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => router.replace('/(auth)/login') }]);
  const confirmDelete = () => Alert.alert('Delete account', 'This permanently deletes your account and data. This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {} }]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      {isLoading || !data ? <StateView kind="loading" /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Group title="Account">
            <ProfileMenuItem icon="User" label="Profile" onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Building2" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Business & team" onPress={() => router.push('/fx/business')} />
            <Divider />
            <ProfileMenuItem icon="Gauge" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Limits & tier" onPress={() => router.push('/fx/settings/limits')} />
          </Group>

          <Group title="Preferences">
            <ProfileMenuItem icon="Coins" label="Default currency" value={CURRENCIES[data.defaultCurrency]?.code ?? data.defaultCurrency ?? '—'} onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Percent" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Display rate" value={data.displayRate === 'all_in' ? 'All-in' : 'Mid-market'} onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Bell" label="Notifications" onPress={() => router.push('/fx/settings/notifications')} />
            <Divider />
            <ProfileMenuItem icon="Languages" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Language" value={data.language} onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Palette" label="Theme" value={data.theme === 'system' ? 'System' : data.theme === 'dark' ? 'Dark' : 'Light'} onPress={() => {}} />
          </Group>

          <Group title="Security & assets">
            <ProfileMenuItem icon="Fingerprint" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Security (biometric, 2FA, devices)" onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Wallet" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Linked stablecoin addresses" value={`${data.stablecoinAddresses?.length ?? 0}`} onPress={() => router.push('/fx/settings/stablecoin')} />
          </Group>

          <Group title="Support">
            <ProfileMenuItem icon="CircleHelp" label="Help & FAQ" onPress={() => {}} />
            <Divider />
            <ProfileMenuItem icon="Headphones" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Contact support" onPress={() => {}} />
          </Group>

          <Group>
            <ProfileMenuItem icon="LogOut" label="Log out" danger showChevron={false} onPress={confirmLogout} />
            <Divider />
            <ProfileMenuItem icon="Trash2" label="Delete account" danger showChevron={false} onPress={confirmDelete} />
          </Group>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      {title ? <Text style={styles.section}>{title}</Text> : <View style={{ height: Spacing.lg }} />}
      <View style={styles.group}>{children}</View>
    </>
  );
}
function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  group: { marginHorizontal: Spacing.containerMargin, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow, marginLeft: Spacing.containerMargin + 40 + Spacing.md },
});
