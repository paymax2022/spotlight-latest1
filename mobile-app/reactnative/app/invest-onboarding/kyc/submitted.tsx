import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function KycSubmittedScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <View style={styles.ring}>
          <Clock size={64} color={Colors.onPrimaryFixedVariant} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Verification submitted</Text>
        <Text style={styles.sub}>
          Thanks — your details are being reviewed. This usually takes just a few minutes, and we'll
          notify you the moment it's done. You can continue setting up while you wait.
        </Text>

        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>Up next</Text>
          <Text style={styles.nextText}>Tell us about your goals so we can suggest suitable products.</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to suitability" onPress={() => router.replace('/invest-onboarding/suitability')} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton label="Check status" variant="ghost" onPress={() => router.replace('/invest-onboarding/kyc/status')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 120, height: 120, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  nextCard: {
    alignSelf: 'stretch', marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  nextLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  nextText: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
