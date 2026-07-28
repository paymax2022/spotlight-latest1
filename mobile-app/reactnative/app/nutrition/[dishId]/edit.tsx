import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useDishNutrition, useEditNutrition } from '@/features/nutrition/hooks';
import type { PortionLabel, MacroNudge } from '@/features/nutrition/types';

const PORTIONS: { value: PortionLabel; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'regular', label: 'Regular' },
  { value: 'large', label: 'Large' },
];

const MACRO_FIELDS: { key: keyof MacroNudge; label: string; unit: string }[] = [
  { key: 'energy_kcal', label: 'Energy', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carb_g', label: 'Carbs', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'sat_fat_g', label: 'Sat fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
];

/**
 * Lightweight edit (v2). INTENTIONALLY only two things: a portion selector and a
 * direct macro nudge. It NEVER asks for ingredients — the ingredient form is an
 * optional, clearly-secondary hidden power-user path linked at the bottom.
 * Saving an edit counts as an explicit vendor approval → RESTAURANT_CONFIRMED.
 */
export default function EditNutritionScreen() {
  const { dishId } = useLocalSearchParams<{ dishId: string }>();
  const { data, isLoading, isError, refetch } = useDishNutrition(dishId);
  const edit = useEditNutrition();

  const [portion, setPortion] = useState<PortionLabel | null>(null);
  const [macros, setMacros] = useState<Record<string, string>>({});

  // Show current values as placeholders so a blank field means "leave as-is".
  const placeholders = useMemo(() => {
    const ps = data?.per_serving;
    if (!ps) return {} as Record<string, string>;
    return {
      energy_kcal: String(ps.energy_kcal.value),
      protein_g: String(ps.protein_g.value),
      carb_g: String(ps.carb_g.value),
      sugar_g: String(ps.sugar_g.value),
      fat_g: String(ps.fat_g.value),
      sat_fat_g: String(ps.sat_fat_g.value),
      fiber_g: String(ps.fiber_g.value),
      sodium_mg: String(ps.sodium_mg.value),
    } as Record<string, string>;
  }, [data]);

  const portionChanged = portion != null && portion !== data?.portion_label;
  const macroEntries = Object.entries(macros).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v)));
  const dirty = portionChanged || macroEntries.length > 0;

  const onSave = async () => {
    if (!dishId || !dirty || edit.isPending) return;
    const macroNudge: MacroNudge = {};
    for (const [k, val] of macroEntries) macroNudge[k as keyof MacroNudge] = Number(val);
    await edit.mutateAsync({
      dishId,
      req: {
        portion_label: portionChanged ? (portion as PortionLabel) : undefined,
        macros: macroEntries.length > 0 ? macroNudge : undefined,
      },
    });
    router.replace(`/nutrition/${dishId}`);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Edit nutrition" subtitle="Portion &amp; macros" />
      {isLoading ? (
        <StateView kind="loading" message="Loading the estimate…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load this dish" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.banner, shadow1]}>
              <Icons.Info size={16} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={s.bannerText}>
                Pick a portion or adjust any number you know better. Leave a field blank to keep its
                estimate. Saving marks the dish restaurant-confirmed.
              </Text>
            </View>

            <Text style={s.label}>Portion size</Text>
            <View style={s.portionRow}>
              {PORTIONS.map((p) => {
                const active = (portion ?? data.portion_label) === p.value;
                return (
                  <Pressable
                    key={p.value}
                    onPress={() => setPortion(p.value)}
                    style={[s.portionChip, active && s.portionActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[s.portionText, active && s.portionTextActive]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.hint}>Rescales every value automatically.</Text>

            <Text style={s.label}>Macro nudge (per serving)</Text>
            {MACRO_FIELDS.map((f) => (
              <View key={f.key} style={[s.macroRow, shadow1]}>
                <Text style={s.macroLabel}>{f.label}</Text>
                <TextInput
                  value={macros[f.key] ?? ''}
                  onChangeText={(t) => setMacros((m) => ({ ...m, [f.key]: t }))}
                  keyboardType="number-pad"
                  placeholder={placeholders[f.key] ?? ''}
                  placeholderTextColor={Colors.outline}
                  style={s.macroInput}
                />
                <Text style={s.macroUnit}>{f.unit}</Text>
              </View>
            ))}

            {/* Clearly-secondary hidden power-user path. NOT part of the main flow. */}
            <Pressable
              onPress={() => router.push(`/nutrition/${dishId}/recipe`)}
              style={s.advancedLink}
              accessibilityRole="link"
            >
              <Icons.FlaskConical size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={s.advancedText}>Advanced: enter ingredients for top-tier accuracy</Text>
              <Icons.ChevronRight size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </ScrollView>

          <View style={s.footer}>
            <PrimaryButton
              label="Save & confirm"
              onPress={onSave}
              loading={edit.isPending}
              disabled={!dirty}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  banner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  portionRow: { flexDirection: 'row', gap: Spacing.sm },
  portionChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  portionActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  portionText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  portionTextActive: { color: Colors.primary },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  macroLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  macroInput: { ...Typography.bodyMd, color: Colors.onSurface, minWidth: 70, textAlign: 'right' },
  macroUnit: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 36 },
  advancedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignSelf: 'flex-start',
  },
  advancedText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textDecorationLine: 'underline' },
  footer: {
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
