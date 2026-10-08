import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCompleteOnboarding } from '@/features/connect/hooks/useConnect';

// ON-15 — Onboarding complete. Land on Discover.
export default function Complete() {
  const complete = useCompleteOnboarding();

  useEffect(() => {
    complete.mutate();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goDiscover = () => router.replace('/connect/discover');
  const goProfile = () => router.replace('/connect/mehub');
  const failedPhotos = complete.data?.photoUploadFailures ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <PartyPopper size={48} color={Colors.onPrimary} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>You’re all set!</Text>
        <Text style={styles.body}>
          Your Connect profile is ready. Start discovering people, streams and events.
        </Text>
        {failedPhotos > 0 ? (
          <Text style={styles.note}>
            {failedPhotos === 1 ? '1 photo' : `${failedPhotos} photos`} couldn’t be uploaded. You can add
            {failedPhotos === 1 ? ' it' : ' them'} again from your profile.
          </Text>
        ) : null}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="View my profile" onPress={goProfile} loading={complete.isPending} />
        <View style={styles.secondary}>
          <PrimaryButton label="Start exploring" variant="secondary" onPress={goDiscover} disabled={complete.isPending} />
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: {
    width: 112, height: 112, borderRadius: Radius.xxl,
    backgroundColor: ConnectColors.brand, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineLgMobile, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  note: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  secondary: { marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
});
