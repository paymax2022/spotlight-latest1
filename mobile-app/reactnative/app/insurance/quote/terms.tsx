import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useQuote } from '@/features/insurance/hooks';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

export default function QuoteTerms() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const quote = useQuote(id ?? '');

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Terms & exclusions" />
        <StateView kind="loading" message="Loading terms…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Terms & exclusions" />
        <StateView kind="error" title="Terms unavailable" actionLabel="Retry" onAction={() => quote.refetch()} />
      </SafeAreaView>
    );
  }

  const q = quote.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Terms & exclusions" subtitle={q.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <UnderwriterBadge disclosure={q.disclosure} />

        <Text style={styles.sectionTitle}>What's covered</Text>
        <View style={styles.card}>
          {q.benefits.map((b) => (
            <View key={b} style={styles.row}>
              <View style={[styles.icon, styles.ok]}><Check size={14} color={InsuranceColors.ok} strokeWidth={2.6} /></View>
              <Text style={styles.text}>{b}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>What's not covered</Text>
        <View style={styles.card}>
          {q.exclusions.map((e) => (
            <View key={e} style={styles.row}>
              <View style={[styles.icon, styles.no]}><X size={14} color={Colors.error} strokeWidth={2.6} /></View>
              <Text style={styles.text}>{e}</Text>
            </View>
          ))}
        </View>

        <View style={styles.legal}>
          <Text style={styles.legalText}>
            Full policy wording is set by the underwriter ({q.disclosure.underwriter}) and provided in
            your certificate after binding. Claims are assessed and paid by the underwriter; Paymax
            facilitates distribution and premium collection only.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.sm },
  icon: { width: 22, height: 22, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ok: { backgroundColor: InsuranceColors.okBg },
  no: { backgroundColor: Colors.errorContainer },
  text: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  legal: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  legalText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
