import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Gauge, Circle, ChevronRight, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStrength } from '@/features/connect/networking/profile/hooks';
import type { StrengthBand, StrengthMissingItem } from '@/features/connect/networking/profile/types';

// PN-1: the meter is driven entirely by the qualitative BAND. There is NO raw
// completion/verification number anywhere in this screen — not rendered, not held.
const BANDS: { band: StrengthBand; label: string; blurb: string }[] = [
  { band: 'beginner', label: 'Beginner', blurb: 'You’re just getting started — add the basics to grow.' },
  { band: 'intermediate', label: 'Intermediate', blurb: 'Good progress. A few more sections will make you stand out.' },
  { band: 'strong', label: 'Strong', blurb: 'A solid, credible profile. You’re nearly there.' },
  { band: 'all_star', label: 'All-Star', blurb: 'Your profile is complete and verified. Excellent.' },
];

// Where each missing item deep-links so the checklist is actionable.
const ITEM_ROUTES: Record<string, string> = {
  about: '/connect/networking/profile/about',
  experience: '/connect/networking/profile/experience',
  education: '/connect/networking/profile/education',
  recommendation: '/connect/networking/recommendations/inbox',
};

/** Profile Strength meter (PRD §6.3 PR-11). PN-1: band + missing items ONLY. */
export default function StrengthScreen() {
  const query = useStrength();
  const data = query.data;
  const bandIndex = data ? BANDS.findIndex((b) => b.band === data.band) : -1;
  const current = bandIndex >= 0 ? BANDS[bandIndex] : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile strength" />
      {query.isLoading ? (
        <StateView kind="loading" message="Checking your profile…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load strength" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : !data || !current ? (
        <StateView kind="empty" icon="Gauge" title="No data" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Band card */}
          <View style={styles.bandCard}>
            <View style={styles.bandIcon}>
              {data.band === 'all_star' ? (
                <Sparkles size={22} color={ConnectColors.warn} strokeWidth={2} />
              ) : (
                <Gauge size={22} color={ConnectColors.brand} strokeWidth={2} />
              )}
            </View>
            <Text style={styles.bandLabel}>{current.label}</Text>
            <Text style={styles.bandBlurb}>{current.blurb}</Text>

            {/* Segmented meter — fills up to the current band. No percentage shown. */}
            <View style={styles.meter}>
              {BANDS.map((b, i) => (
                <View
                  key={b.band}
                  style={[styles.segment, i <= bandIndex ? styles.segmentFilled : styles.segmentEmpty]}
                />
              ))}
            </View>
            <View style={styles.meterLabels}>
              {BANDS.map((b, i) => (
                <Text key={b.band} style={[styles.meterLabel, i === bandIndex && styles.meterLabelActive]}>
                  {b.label}
                </Text>
              ))}
            </View>
          </View>

          {/* Missing checklist */}
          <Text style={styles.sectionTitle}>
            {data.missing.length === 0 ? 'All done' : 'To level up'}
          </Text>
          {data.missing.length === 0 ? (
            <View style={styles.doneCard}>
              <Sparkles size={18} color={ConnectColors.ok} strokeWidth={2} />
              <Text style={styles.doneText}>Nothing left — your profile is at its strongest band.</Text>
            </View>
          ) : (
            <View style={styles.checklist}>
              {data.missing.map((item) => (
                <MissingRow key={item.key} item={item} />
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MissingRow({ item }: { item: StrengthMissingItem }) {
  const route = ITEM_ROUTES[item.key];
  const tappable = !!route;
  return (
    <Pressable
      style={styles.checkRow}
      disabled={!tappable}
      accessibilityRole={tappable ? 'button' : undefined}
      onPress={() => tappable && router.push(route)}
    >
      <Circle size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      <Text style={styles.checkLabel}>{item.label}</Text>
      {tappable ? <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  bandCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  bandIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
    marginBottom: Spacing.xs,
  },
  bandLabel: { ...Typography.headlineMd, color: Colors.onSurface },
  bandBlurb: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  meter: { flexDirection: 'row', gap: 6, width: '100%', marginTop: Spacing.md },
  segment: { flex: 1, height: 8, borderRadius: Radius.full },
  segmentFilled: { backgroundColor: ConnectColors.brand },
  segmentEmpty: { backgroundColor: Colors.surfaceContainerHigh },
  meterLabels: { flexDirection: 'row', width: '100%', marginTop: 6 },
  meterLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, textAlign: 'center' },
  meterLabelActive: { color: ConnectColors.brand, fontWeight: '700' },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  doneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  doneText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  checklist: { gap: Spacing.sm },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  checkLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
