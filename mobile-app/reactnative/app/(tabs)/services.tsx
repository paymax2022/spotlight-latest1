import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SearchBar from '@/components/SearchBar';
import ElectionHeaderBanner from '@/features/election/components/ElectionHeaderBanner';
import ModuleGrid from '@/components/ModuleGrid';
import SectionHeader from '@/components/SectionHeader';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SERVICE_MODULES } from '@/constants/modules';

const CATEGORIES = [
  { key: 'all',       label: 'All' },
  { key: 'financial', label: 'Finance' },
  { key: 'utility',   label: 'Utility' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'business',  label: 'Business' },
] as const;

type Cat = typeof CATEGORIES[number]['key'];

export default function ServicesScreen() {
  const [activeCat, setActiveCat] = useState<Cat>('all');
  const [search, setSearch]       = useState('');

  const modules = SERVICE_MODULES.filter((m) => {
    const matchesCat  = activeCat === 'all' || m.category === activeCat;
    const matchesSearch = !search || m.label.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>All Services</Text>
      </View>

      <ElectionHeaderBanner />

      <SearchBar value={search} onChangeText={setSearch} placeholder="Search a service…" />

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
        {CATEGORIES.map((cat) => (
          <Pressable key={cat.key} onPress={() => setActiveCat(cat.key)} style={[styles.chip, activeCat === cat.key && styles.chipActive]}>
            <Text style={[styles.chipLabel, activeCat === cat.key && styles.chipLabelActive]}>{cat.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 100 : 80, paddingTop: Spacing.md }}>
        {modules.length === 0
          ? <Text style={styles.empty}>No services found for "{search}"</Text>
          : <ModuleGrid modules={modules} />
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:  { ...Typography.headlineMd, color: Colors.onSurface },
  chips:  { flexGrow: 0, marginBottom: Spacing.sm },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.surfaceContainerLow,
    borderWidth:       1,
    borderColor:       Colors.outlineVariant,
  },
  chipActive:      { backgroundColor: Colors.primaryContainer, borderColor: Colors.primaryContainer },
  chipLabel:       { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.onPrimaryContainer },
  empty: { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center', marginTop: Spacing.xxl },
});
