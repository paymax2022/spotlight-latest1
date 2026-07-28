import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
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
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Start exploring" onPress={goDiscover} loading={complete.isPending} />
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
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
});
