import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function OnboardingSuccess() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.icon}><CheckCircle2 size={48} color={Colors.teal} strokeWidth={2} /></View>
        <Text style={styles.title}>You're all set</Text>
        <Text style={styles.sub}>
          Your investing account is active. Explore opportunities and start building your real estate portfolio.
        </Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="Explore opportunities" onPress={() => router.replace('/fractionalre/market')} />
        <PrimaryButton label="Go to dashboard" variant="secondary" onPress={() => router.replace('/fractionalre')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  icon: { width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
