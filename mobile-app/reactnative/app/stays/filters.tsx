import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useStaysStore } from '@/features/stays/store';
import { AMENITIES, STAR_OPTIONS, PROPERTY_TYPES, formatNaira } from '@/features/stays/constants/stays.constants';
import type { PropertyType, StaysFilter } from '@/features/stays/types';

const SCORE_OPTIONS = [
  { value: 9, label: 'Superb 9+' },
  { value: 8, label: 'Very good 8+' },
  { value: 7, label: 'Good 7+' },
];

const BOARDS: { value: NonNullable<StaysFilter['boardBasis']>; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast included' },
  { value: 'half_board', label: 'Half board' },
  { value: 'full_board', label: 'Full board' },
];

export default function FiltersScreen() {
  const { filter, setFilter, resetFilter } = useStaysStore();
  const [local, setLocal] = useState<StaysFilter>(filter);

  const patch = (p: Partial<StaysFilter>) => setLocal((s) => ({ ...s, ...p }));

  const toggleStar = (s: number) => {
    const cur = local.stars ?? [];
    patch({ stars: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  };
  const toggleType = (t: PropertyType) => {
    const cur = local.propertyTypes ?? [];
    patch({ propertyTypes: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
  };
  const toggleAmenity = (a: string) => {
    const cur = local.amenities ?? [];
    patch({ amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] });
  };

  const apply = () => {
    setFilter(local);
    router.back();
  };
  const clear = () => {
    resetFilter();
    setLocal({ sort: local.sort });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Filters"
        rightSlot={<Pressable onPress={clear} hitSlop={8}><Text style={styles.clear}>Clear</Text></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Price */}
        <Section title="Price per night (NGN)">
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <TextInputField
                label="Min"
                keyboardType="number-pad"
                value={local.minPriceKobo != null ? String(local.minPriceKobo / 100) : ''}
                onChangeText={(t) => patch({ minPriceKobo: t ? Number(t) * 100 : undefined })}
                placeholder="0"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextInputField
                label="Max"
                keyboardType="number-pad"
                value={local.maxPriceKobo != null ? String(local.maxPriceKobo / 100) : ''}
                onChangeText={(t) => patch({ maxPriceKobo: t ? Number(t) * 100 : undefined })}
                placeholder="Any"
              />
            </View>
          </View>
          {local.minPriceKobo != null || local.maxPriceKobo != null ? (
            <Text style={styles.priceNote}>
              {formatNaira(local.minPriceKobo ?? 0)} – {local.maxPriceKobo != null ? formatNaira(local.maxPriceKobo) : 'Any'}
            </Text>
          ) : null}
        </Section>

        {/* Review score */}
        <Section title="Review score">
          <Chips
            options={SCORE_OPTIONS.map((s) => ({ key: String(s.value), label: s.label }))}
            selected={local.minScore != null ? [String(local.minScore)] : []}
            onToggle={(k) => patch({ minScore: local.minScore === Number(k) ? undefined : Number(k) })}
          />
        </Section>

        {/* Star rating */}
        <Section title="Star rating">
          <Chips
            options={STAR_OPTIONS.map((s) => ({ key: String(s), label: `${s} stars` }))}
            selected={(local.stars ?? []).map(String)}
            onToggle={(k) => toggleStar(Number(k))}
          />
        </Section>

        {/* Property type */}
        <Section title="Property type">
          <Chips
            options={PROPERTY_TYPES.map((t) => ({ key: t.value, label: t.label }))}
            selected={(local.propertyTypes ?? []) as string[]}
            onToggle={(k) => toggleType(k as PropertyType)}
          />
        </Section>

        {/* Amenities */}
        <Section title="Amenities">
          <View style={styles.amenityGrid}>
            {AMENITIES.map((a) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[a.icon] ?? Icons.Check;
              const on = (local.amenities ?? []).includes(a.key);
              return (
                <Pressable key={a.key} style={[styles.amenity, on && styles.amenityOn]} onPress={() => toggleAmenity(a.key)}>
                  <Icon size={16} color={on ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={[styles.amenityText, on && styles.amenityTextOn]}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Board basis */}
        <Section title="Board basis">
          <Chips
            options={BOARDS.map((b) => ({ key: b.value, label: b.label }))}
            selected={local.boardBasis ? [local.boardBasis] : []}
            onToggle={(k) => patch({ boardBasis: local.boardBasis === k ? undefined : (k as StaysFilter['boardBasis']) })}
          />
        </Section>

        {/* Toggles */}
        <Section title="More">
          <Toggle label="Free cancellation only" value={!!local.freeCancellation} onToggle={() => patch({ freeCancellation: !local.freeCancellation })} />
          <Toggle label="Deals & offers only" value={!!local.dealsOnly} onToggle={() => patch({ dealsOnly: !local.dealsOnly })} />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Show results" onPress={apply} />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chips({ options, selected, onToggle }: { options: { key: string; label: string }[]; selected: string[]; onToggle: (k: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <Pressable key={o.key} style={[styles.chip, on && styles.chipOn]} onPress={() => onToggle(o.key)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.checkbox, value && styles.checkboxOn]}>
        {value ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  clear: { ...Typography.labelMd, color: Colors.secondary },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  priceRow: { flexDirection: 'row', gap: Spacing.md },
  priceNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  amenityOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLowest },
  amenityText: { ...Typography.labelMd, color: Colors.onSurface },
  amenityTextOn: { color: Colors.primary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  toggleLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
