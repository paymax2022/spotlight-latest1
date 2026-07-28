import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, Droplet, FlaskConical, Info, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTest } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import { SAMPLE_TYPE_LABEL } from '@/features/health/lab/constants';

export default function TestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: test, isLoading, isError, refetch } = useTest(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Test" />
        <StateView kind="loading" message="Loading test…" />
      </SafeAreaView>
    );
  }
  if (isError || !test) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Test" />
        <StateView kind="error" title="Couldn't load test" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={test.code} subtitle={test.name} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: test.imageColor }]}>
            <FlaskConical size={26} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.name}>{test.name}</Text>
          <Text style={styles.price}>{formatNaira(test.priceKobo)}</Text>
        </View>

        {/* prep + TAT chips */}
        <View style={styles.metaRow}>
          <View style={[styles.metaCard, shadow1]}>
            <Clock size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.metaLabel}>Turnaround</Text>
            <Text style={styles.metaValue}>{test.tat}</Text>
          </View>
          <View style={[styles.metaCard, shadow1]}>
            <Droplet size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.metaLabel}>Sample</Text>
            <Text style={styles.metaValue}>{SAMPLE_TYPE_LABEL[test.sampleType] ?? test.sampleType}</Text>
          </View>
        </View>

        {/* Fasting callout */}
        {test.fastingRequired ? (
          <View style={styles.fasting}>
            <Info size={16} color={Colors.onWarning} strokeWidth={2} />
            <Text style={styles.fastingText}>Fasting required — do not eat for the time stated in the prep below.</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>About this test</Text>
        <Text style={styles.body}>{test.description}</Text>

        <Text style={styles.sectionTitle}>Preparation</Text>
        <View style={[styles.prepCard, shadow1]}>
          <Text style={styles.prepText}>{test.prep}</Text>
        </View>

        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>
            Processed by MLSCN-verified labs. Home collection {test.homeCollection ? 'available' : 'not available'} for this test.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Choose lab & book"
          onPress={() =>
            router.push({
              pathname: '/health/lab/lab-select',
              params: { testId: test.id, name: test.name, priceKobo: String(test.priceKobo), homeCollection: test.homeCollection ? '1' : '0' },
            })
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  price: { ...Typography.titleLg, color: Colors.primary },
  metaRow: { flexDirection: 'row', gap: Spacing.md },
  metaCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.labelLg, color: Colors.onSurface },
  fasting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  fastingText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  prepCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  prepText: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  trust: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  trustText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
