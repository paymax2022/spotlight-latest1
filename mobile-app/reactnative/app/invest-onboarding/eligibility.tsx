import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useEligibility } from '@/features/investonboarding/hooks/useOnboarding';

export default function EligibilityScreen() {
  const { data, isLoading, isError, refetch } = useEligibility();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Region check" />
        <StateView kind="loading" message="Checking availability…" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Region check" />
        <StateView kind="error" title="Couldn't check eligibility" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  // Restricted / product-unavailable → blocking state, no path forward.
  if (!data.investEnabled || data.state === 'product_unavailable' || data.state === 'restricted') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Region check" />
        <StateView
          kind="empty"
          icon="MapPinOff"
          title="Not available in your region yet"
          message={data.message || 'Paymax Invest is not available where you are right now. We are working to expand — check back soon.'}
          actionLabel="Back to home"
          onAction={() => router.dismissAll()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Region check" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.iconBox}>
            <CircleCheck size={28} color={Colors.tertiaryContainer} strokeWidth={2} />
          </View>
          <Text style={styles.title}>You're eligible</Text>
          <Text style={styles.sub}>{data.message}</Text>
        </View>

        <View style={styles.rows}>
          <View style={styles.row}>
            <MapPin size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.rowLabel}>Region</Text>
            <Text style={styles.rowValue}>{data.region}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <MapPin size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.rowLabel}>Residency</Text>
            <Text style={styles.rowValue}>{data.residency}</Text>
          </View>
        </View>

        <Text style={styles.note}>
          Next, we'll verify your identity. This is a legal requirement to keep your account secure.
        </Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue to verification" onPress={() => router.push('/invest-onboarding/kyc/status')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  card: {
    alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg,
  },
  iconBox: {
    width: 64, height: 64, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  rows: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
