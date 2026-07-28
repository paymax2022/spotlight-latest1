import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FlaskConical, Clock, Droplet, Building2, House } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useLab } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import { COLLECTION_MODE_LABEL } from '@/features/health/lab/constants';
import type { CollectionMode } from '@/features/health/lab/types';

export default function BookScreen() {
  const params = useLocalSearchParams<{
    testId?: string;
    packageId?: string;
    name?: string;
    priceKobo?: string;
    labId?: string;
    mode?: string;
  }>();
  const mode = (params.mode as CollectionMode) ?? 'walk_in';
  const { data: lab, isLoading, isError, refetch } = useLab(params.labId);
  const priceKobo = Number(params.priceKobo ?? 0);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book test" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !lab) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book test" />
        <StateView kind="error" title="Couldn't load lab" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const onContinue = () => {
    if (mode === 'home') {
      router.push({ pathname: '/health/lab/home-collection', params });
    } else {
      router.push({ pathname: '/health/lab/checkout', params: { ...params, location: lab.address } });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review booking" subtitle={lab.name} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Test summary */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: Colors.iconBgTeal }]}>
              <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{params.name}</Text>
              <Text style={styles.sub}>{params.packageId ? 'Health package' : 'Single test'}</Text>
            </View>
            <Text style={styles.price}>{formatNaira(priceKobo)}</Text>
          </View>
        </View>

        {/* Collection mode */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
              {mode === 'home' ? (
                <House size={18} color={Colors.secondary} strokeWidth={2} />
              ) : (
                <Building2 size={18} color={Colors.secondary} strokeWidth={2} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{COLLECTION_MODE_LABEL[mode]}</Text>
              <Text style={styles.sub}>
                {mode === 'home'
                  ? `Phlebotomist visits you · ${formatNaira(lab.homeCollectionFeeKobo)} fee`
                  : lab.address}
              </Text>
            </View>
          </View>
        </View>

        {/* Prep reminder */}
        <View style={styles.prep}>
          <Droplet size={16} color={Colors.onWarning} strokeWidth={2} />
          <Text style={styles.prepText}>
            Follow any fasting/preparation instructions on the test before your sample is taken. Your result ETA is {lab.resultEtaLabel.toLowerCase()}.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={mode === 'home' ? 'Schedule collection' : 'Continue to payment'}
          onPress={onContinue}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleMd, color: Colors.primary },
  prep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  prepText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
