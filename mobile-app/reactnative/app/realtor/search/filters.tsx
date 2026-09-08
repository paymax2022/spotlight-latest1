import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { useSearchStore } from '@/features/realtor/store/searchStore';
import {
  PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABEL,
  FURNISHING_OPTIONS, FURNISHING_LABEL,
  AMENITY_OPTIONS, AMENITY_LABEL,
  BEDROOM_OPTIONS, PRICE_ANCHORS_KOBO,
} from '@/features/realtor/constants/realtor.constants';
import { formatNairaCompact } from '@/features/realtor/utils/realtorFormatters';
import type { ListingFilter, PropertyType, Furnishing, Amenity } from '@/features/realtor/types/realtor.types';

export default function FiltersScreen() {
  const store = useSearchStore();
  const [draft, setDraft] = useState<ListingFilter>({ ...store.filter });

  const patch = (p: Partial<ListingFilter>) => setDraft((d) => ({ ...d, ...p }));
  const toggleAmenity = (a: Amenity) =>
    setDraft((d) => {
      const set = new Set(d.amenities ?? []);
      set.has(a) ? set.delete(a) : set.add(a);
      return { ...d, amenities: set.size ? Array.from(set) : undefined };
    });

  const apply = () => { store.replaceFilter(draft); goBack('/realtor/search'); };
  const clearAll = () => setDraft({ sort: draft.sort });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Filters</Text>
        <Pressable onPress={() => goBack('/realtor/search')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close filters">
          <X size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Property type */}
        <SelectField
          label="Property type"
          placeholder="Any type"
          value={draft.propertyType ? PROPERTY_TYPE_LABEL[draft.propertyType] : undefined}
          options={PROPERTY_TYPE_OPTIONS.map((t) => PROPERTY_TYPE_LABEL[t])}
          onChange={(label) => {
            const key = PROPERTY_TYPE_OPTIONS.find((t) => PROPERTY_TYPE_LABEL[t] === label);
            patch({ propertyType: key as PropertyType });
          }}
        />

        {/* Bedrooms */}
        <Text style={styles.label}>Bedrooms (min)</Text>
        <View style={styles.pillRow}>
          {BEDROOM_OPTIONS.map((b) => {
            const active = draft.minBedrooms === b;
            return (
              <Pressable key={b} style={[styles.pill, active && styles.pillActive]} onPress={() => patch({ minBedrooms: active ? undefined : b })}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{b}+</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Max price */}
        <Text style={styles.label}>Max price</Text>
        <View style={styles.pillRow}>
          {PRICE_ANCHORS_KOBO.map((p) => {
            const active = draft.maxPrice === p;
            return (
              <Pressable key={p} style={[styles.pill, active && styles.pillActive]} onPress={() => patch({ maxPrice: active ? undefined : p })}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{formatNairaCompact(p)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Furnishing */}
        <SelectField
          label="Furnishing"
          placeholder="Any"
          value={draft.furnishing ? FURNISHING_LABEL[draft.furnishing] : undefined}
          options={FURNISHING_OPTIONS.map((f) => FURNISHING_LABEL[f])}
          searchable={false}
          onChange={(label) => {
            const key = FURNISHING_OPTIONS.find((f) => FURNISHING_LABEL[f] === label);
            patch({ furnishing: key as Furnishing });
          }}
        />

        {/* Amenities */}
        <Text style={styles.label}>Amenities</Text>
        <View style={styles.pillRow}>
          {AMENITY_OPTIONS.map((a) => {
            const active = draft.amenities?.includes(a);
            return (
              <Pressable key={a} style={[styles.pill, active && styles.pillActive]} onPress={() => toggleAmenity(a)}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{AMENITY_LABEL[a]}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Trust toggles */}
        <Text style={styles.label}>Trust</Text>
        <Pressable style={styles.toggleRow} onPress={() => patch({ verifiedOnly: !draft.verifiedOnly })}>
          <View>
            <Text style={styles.toggleTitle}>Verified listings only</Text>
            <Text style={styles.toggleSub}>Hide unverified properties</Text>
          </View>
          <View style={[styles.switch, draft.verifiedOnly && styles.switchOn]}>
            <View style={[styles.knob, draft.verifiedOnly && styles.knobOn]} />
          </View>
        </Pressable>
        <Pressable style={styles.toggleRow} onPress={() => patch({ escrowOnly: !draft.escrowOnly })}>
          <View>
            <Text style={styles.toggleTitle}>Escrow-protected only</Text>
            <Text style={styles.toggleSub}>Deposits held safely until move-in</Text>
          </View>
          <View style={[styles.switch, draft.escrowOnly && styles.switchOn]}>
            <View style={[styles.knob, draft.escrowOnly && styles.knobOn]} />
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={clearAll} hitSlop={8} style={styles.clearBtn}>
          <Text style={styles.clearText}>Clear all</Text>
        </Pressable>
        <View style={styles.applyWrap}>
          <PrimaryButton label="Show results" onPress={apply} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  pillActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  pillText: { ...Typography.labelSm, color: Colors.onSurface },
  pillTextActive: { color: Colors.primary, fontWeight: '700' as const },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerLow,
  },
  toggleTitle: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  toggleSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  clearBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm },
  clearText: { ...Typography.labelMd, color: Colors.secondary },
  applyWrap: { flex: 1 },
});
