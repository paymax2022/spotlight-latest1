import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import ToggleRow from '@/features/connect/components/ToggleRow';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { MIN_AGE } from '@/features/connect/constants/connect.constants';
import type { DiscoveryFilters } from '@/features/connect/discovery/types';

const DISTANCE_OPTIONS: { value: string; label: string }[] = [
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
  { value: '100', label: '100 km' },
];

const INTEREST_LIST = ['Design', 'Tech', 'Music', 'Travel', 'Fitness', 'Food', 'Art', 'Startups'];

const DEFAULT_FILTERS: DiscoveryFilters = {
  mode: 'date',
  minAge: 18,
  maxAge: 60,
  maxDistanceKm: 50,
  verifiedOnly: false,
  interests: [],
};

/**
 * Discovery filters (PRD §10.2). Local-only state — applying just pops back; the
 * stack screen owns the live filter object. 18+ floor (SAFETY §1) is enforced on
 * the age inputs via MIN_AGE.
 */
export default function FiltersScreen() {
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_FILTERS);
  const [minAgeText, setMinAgeText] = useState(String(DEFAULT_FILTERS.minAge));
  const [maxAgeText, setMaxAgeText] = useState(String(DEFAULT_FILTERS.maxAge));

  function commitMinAge(raw: string) {
    setMinAgeText(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      setFilters((f) => ({ ...f, minAge: Math.max(MIN_AGE, parsed) }));
    }
  }

  function commitMaxAge(raw: string) {
    setMaxAgeText(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      setFilters((f) => ({ ...f, maxAge: Math.max(MIN_AGE, parsed) }));
    }
  }

  function toggleInterest(value: string) {
    setFilters((f) => ({
      ...f,
      interests: f.interests.includes(value)
        ? f.interests.filter((i) => i !== value)
        : [...f.interests, value],
    }));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Filters" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.titlePad]}>Maximum distance</Text>
          <SegmentedControl
            scrollable
            options={DISTANCE_OPTIONS}
            value={String(filters.maxDistanceKm)}
            onChange={(v) => setFilters((f) => ({ ...f, maxDistanceKm: parseInt(v, 10) }))}
          />
        </View>

        <View style={[styles.section, styles.padded]}>
          <Text style={styles.sectionTitle}>Age range</Text>
          <View style={styles.ageRow}>
            <View style={styles.ageField}>
              <TextInputField
                label="Min age"
                keyboardType="numeric"
                value={minAgeText}
                onChangeText={commitMinAge}
              />
            </View>
            <View style={styles.ageField}>
              <TextInputField
                label="Max age"
                keyboardType="numeric"
                value={maxAgeText}
                onChangeText={commitMaxAge}
              />
            </View>
          </View>
          <Text style={styles.hint}>Minimum age is {MIN_AGE}.</Text>
        </View>

        <View style={[styles.section, styles.padded]}>
          <ToggleRow
            label="Verified profiles only"
            sub="Only show people who passed verification."
            value={filters.verifiedOnly}
            onValueChange={(v) => setFilters((f) => ({ ...f, verifiedOnly: v }))}
          />
        </View>

        <View style={[styles.section, styles.padded]}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <DiscoveryChipRow
            items={INTEREST_LIST}
            selected={filters.interests}
            onToggle={toggleInterest}
            variant="selectable"
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Apply filters" onPress={() => goBack('/connect')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: Spacing.xl },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  padded: { paddingHorizontal: Spacing.containerMargin },
  sectionTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
  },
  titlePad: { paddingHorizontal: Spacing.containerMargin },
  ageRow: { flexDirection: 'row', gap: Spacing.md },
  ageField: { flex: 1 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
