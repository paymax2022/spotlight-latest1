import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, ToggleRow, InfoRow, StateView } from '@/features/doctor/components';
import { useSecuritySettings, useSetBiometric } from '@/features/doctor/hooks';
import { TWO_FACTOR_METHOD_LABELS } from '@/features/doctor/constants';

// ── Section AC — Security settings (AC.7 / AC.9) ──────────────────────────────
// NEW screen: biometric toggle (AC.9), 2FA status, last-password-change, links
// to change-password (AC.8) and two-factor setup (AC.10). Reuses ToggleRow /
// InfoRow / ProfileMenuItem.

export default function SecuritySettingsScreen() {
  const { data: security, isLoading, isError, refetch } = useSecuritySettings();
  const setBiometric = useSetBiometric();

  const handleBiometric = (value: boolean) => {
    setBiometric.mutate({ enabled: value }, {
      onError: () => Alert.alert('Failed', 'Could not update biometric login. Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Security" />
      {isLoading && !security ? (
        <StateView variant="loading" label="Loading security" />
      ) : isError || !security ? (
        <StateView variant="error" message="We could not load your security settings." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.groupTitle}>Sign-in</Text>
          <View style={styles.toggleGroup}>
            <ToggleRow
              icon={Fingerprint}
              iconColor={Colors.primary}
              bgColor={Colors.iconBgPurple}
              label="Biometric login"
              description={security.biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
              value={security.biometricEnabled}
              onValueChange={handleBiometric}
              disabled={setBiometric.isPending}
            />
          </View>

          <SectionCard title="Two-factor authentication" style={styles.card}>
            <InfoRow label="Status" value={security.twoFactorEnabled ? 'On' : 'Off'} valueColor={security.twoFactorEnabled ? Colors.teal : Colors.onSurfaceVariant} />
            <InfoRow label="Method" value={TWO_FACTOR_METHOD_LABELS[security.twoFactorMethod]} />
          </SectionCard>

          <View style={styles.menu}>
            <ProfileMenuItem icon="ShieldCheck" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Set up two-factor authentication" onPress={() => router.push('/(doctor)/settings/security/two-factor')} />
            <View style={styles.divider} />
            <ProfileMenuItem icon="KeyRound" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Change password" onPress={() => router.push('/(doctor)/settings/security/change-password')} />
          </View>

          {!!security.lastPasswordChange && (
            <Text style={styles.footer}>
              Password last changed {new Date(security.lastPasswordChange).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  toggleGroup: { gap: Spacing.sm, marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  menu:        { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider:     { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
  footer:      { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.md, textAlign: 'center' },
});
