import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/features/connect/components/ToggleRow';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import {
  NETWORK_SKILL_OPTIONS,
  NETWORK_OPEN_TO_OPTIONS,
} from '@/features/connect/networking/api';
import type { NetworkFilters } from '@/features/connect/networking/types';

const DISTANCE_OPTIONS: { value: string; label: string }[] = [
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
  { value: '100', label: '100 km' },
  { value: '250', label: '250+ km' },
];

const DEFAULTS: NetworkFilters = {
  query: '',
  maxDistanceKm: 50,
  verifiedOnly: false,
  skills: [],
  openTo: [],
};

/**
 * Networking filters (PRD §10.3). Local-only state — "Apply" simply returns to
 * the feed (the feed owns its own filter state for the mock phase).
 */
export default function NetworkFiltersScreen() {
  const [filters, setFilters] = useState<NetworkFilters>(DEFAULTS);

  function toggle(list: keyof Pick<NetworkFilters, 'skills' | 'openTo'>, value: string) {
    setFilters((f) => {
      const current = f[list];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...f, [list]: next };
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Filters" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Section title="Maximum distance">
          <SegmentedControl
            scrollable
            options={DISTANCE_OPTIONS}
            value={String(filters.maxDistanceKm)}
            onChange={(v) => setFilters((f) => ({ ...f, maxDistanceKm: Number(v) }))}
          />
        </Section>

        <View style={styles.toggleWrap}>
          <ToggleRow
            label="Verified only"
            sub="Show people with at least one verification badge"
            value={filters.verifiedOnly}
            onValueChange={(v) => setFilters((f) => ({ ...f, verifiedOnly: v }))}
          />
        </View>

        <Section title="Skills" inset>
          <DiscoveryChipRow
            items={NETWORK_SKILL_OPTIONS}
            selected={filters.skills}
            onToggle={(v) => toggle('skills', v)}
            variant="selectable"
          />
        </Section>

        <Section title="Open to" inset>
          <DiscoveryChipRow
            items={NETWORK_OPEN_TO_OPTIONS}
            selected={filters.openTo}
            onToggle={(v) => toggle('openTo', v)}
            variant="selectable"
          />
        </Section>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Apply" onPress={() => goBack('/connect')} />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children, inset }: { title: string; children: React.ReactNode; inset?: boolean }) {
  return (
    <View style={[styles.section, inset && styles.sectionInset]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionInset: { paddingHorizontal: Spacing.containerMargin },
  sectionTitle: {
    ...Typography.labelLg,
    color: Colors.onSurface,
    fontWeight: '700',
    paddingHorizontal: Spacing.containerMargin,
  },
  toggleWrap: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
