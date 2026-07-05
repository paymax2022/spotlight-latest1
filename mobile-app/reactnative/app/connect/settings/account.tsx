import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SettingsList, { SettingsGroupDef } from '@/features/connect/components/SettingsList';
import { useMeSummary } from '@/features/connect/hooks/useConnect';

// ST-03 — Account settings. Identity, linked super-app account.
export default function AccountSettings() {
  const { data, isLoading, error, refetch } = useMeSummary();

  const groups: SettingsGroupDef[] = [
    {
      title: 'Identity',
      rows: [
        { icon: 'ScanFace', label: 'Liveness verification', sub: data?.verification.liveness === 'passed' ? 'Verified' : 'Not verified', href: '/connect/onboarding/liveness' },
        { icon: 'BadgeCheck', label: 'BVN / NIN', sub: data?.verification.identity === 'passed' ? 'Linked' : 'Not linked', href: '/connect/onboarding/bvn-nin' },
      ],
    },
    {
      title: 'Linked account',
      rows: [
        { icon: 'Smartphone', label: 'Paymax super-app', sub: 'Single sign-on — managed in Paymax', href: '/(tabs)/profile' },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Account" />
      {isLoading ? (
        <StateView kind="loading" message="Loading account…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load account" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <Text style={styles.label}>Display name</Text>
            <Text style={styles.value}>{data.displayName}</Text>
          </View>
          <SettingsList groups={groups} />
          <Text style={styles.note}>
            Your login, password and MFA are managed by your Paymax account. Connect uses single sign-on.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.lg,
  },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  value: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.lg },
});
