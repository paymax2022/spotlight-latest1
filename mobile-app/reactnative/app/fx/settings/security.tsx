import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Fingerprint, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import ToggleRow from '@/features/doctor/components/ToggleRow';
import { useSettings, useUpdateSettings } from '@/features/fx/hooks/useFxAccount';

// FX security settings — biometric unlock, two-factor and PIN. Toggles persist via
// the shared FxSettings (useUpdateSettings); the transaction PIN is set on the
// shared security flow. No money moves here — these are auth preferences.
export default function FxSecurityScreen() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Security" />
      {isLoading || !data ? <StateView kind="loading" /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.section}>Sign-in</Text>
          <View style={styles.group}>
            <ToggleRow
              label="Biometric unlock"
              description="Use Face ID / fingerprint to open the app"
              icon={Fingerprint}
              iconColor={Colors.secondary}
              bgColor={Colors.iconBgBlue}
              value={data.biometricEnabled}
              disabled={update.isPending}
              onValueChange={(v) => update.mutate({ biometricEnabled: v })}
            />
            <ToggleRow
              label="Two-factor authentication"
              description="Require a one-time code on new sign-ins"
              icon={ShieldCheck}
              iconColor={Colors.teal}
              bgColor={Colors.iconBgTeal}
              value={data.twoFactorEnabled}
              disabled={update.isPending}
              onValueChange={(v) => update.mutate({ twoFactorEnabled: v })}
            />
          </View>

          <Text style={styles.section}>Transaction PIN</Text>
          <View style={styles.group}>
            <ProfileMenuItem
              icon="KeyRound"
              label="Change transaction PIN"
              onPress={() => router.push('/security/set-pin')}
            />
          </View>

          <Text style={styles.hint}>Your PIN authorises payments. Never share it with anyone — Paymax will never ask for it.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  group: { gap: Spacing.sm, borderRadius: Radius.lg, overflow: 'hidden' },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
});
