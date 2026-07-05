import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useDeclareRecipe } from '@/features/nutrition/hooks';
import type { RecipeIngredient, NutritionGrounding } from '@/features/nutrition/types';

interface Draft {
  food_code: string;
  quantity_g: string;
  prep_method: string;
}

const PREP_METHODS = ['raw', 'boiled', 'fried', 'grilled', 'steamed', 'baked'];

/**
 * Recipe entry — the OPTIONAL hidden power-user path (v2). Never required, never
 * shown during onboarding; reached only via the "Advanced: enter ingredients"
 * link on the edit screen. The vendor sets the portion size and lists
 * ingredients (food code + grams + prep) to ground the highest-accuracy profile.
 */
export default function RecipeEditScreen() {
  const { dishId } = useLocalSearchParams<{ dishId: string }>();
  const declare = useDeclareRecipe();

  const [portion, setPortion] = useState('420');
  const [cookMethod, setCookMethod] = useState('fried');
  const [rows, setRows] = useState<Draft[]>([{ food_code: '', quantity_g: '', prep_method: 'boiled' }]);

  const addRow = () => setRows((r) => [...r, { food_code: '', quantity_g: '', prep_method: 'boiled' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setRow = (i: number, patch: Partial<Draft>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const portionNum = Number(portion) || 0;
  const valid =
    portionNum > 0 &&
    rows.some((r) => r.food_code.trim().length > 0 && Number(r.quantity_g) > 0);

  const onSave = async () => {
    if (!dishId || !valid || declare.isPending) return;
    const ingredients: RecipeIngredient[] = rows
      .filter((r) => r.food_code.trim() && Number(r.quantity_g) > 0)
      .map((r) => ({
        food_code: r.food_code.trim(),
        grounding: 'LIBRARY_MATCHED' as NutritionGrounding,
        quantity_g: Number(r.quantity_g),
        prep_method: r.prep_method,
      }));
    await declare.mutateAsync({
      dishId,
      req: { ingredients, portion_size_g: portionNum, cook_method: cookMethod },
    });
    // Back to the confirm screen — the profile is now recipe-sourced & precise.
    router.replace(`/nutrition/${dishId}`);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Advanced: ingredients" subtitle="Optional · top-tier accuracy" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.label}>Portion size (g)</Text>
        <View style={[s.inputWrap, shadow1]}>
          <Icons.Scale size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <TextInput
            value={portion}
            onChangeText={setPortion}
            keyboardType="number-pad"
            placeholder="e.g. 420"
            placeholderTextColor={Colors.outline}
            style={s.input}
          />
          <Text style={s.unit}>g</Text>
        </View>

        <Text style={s.label}>Cook method</Text>
        <View style={s.chipRow}>
          {PREP_METHODS.map((m) => (
            <Pressable
              key={m}
              onPress={() => setCookMethod(m)}
              style={[s.chip, cookMethod === m && s.chipActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: cookMethod === m }}
            >
              <Text style={[s.chipText, cookMethod === m && s.chipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Ingredients</Text>
        {rows.map((row, i) => (
          <View key={i} style={[s.card, shadow1]}>
            <View style={s.rowHeader}>
              <Text style={s.rowTitle}>Ingredient {i + 1}</Text>
              {rows.length > 1 ? (
                <Pressable onPress={() => removeRow(i)} hitSlop={8} accessibilityLabel="Remove ingredient">
                  <Icons.Trash2 size={16} color={Colors.error} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
            <View style={s.fieldRow}>
              <TextInput
                value={row.food_code}
                onChangeText={(t) => setRow(i, { food_code: t })}
                placeholder="Food code / name (e.g. rice_white)"
                placeholderTextColor={Colors.outline}
                style={[s.cellInput, { flex: 2 }]}
              />
              <TextInput
                value={row.quantity_g}
                onChangeText={(t) => setRow(i, { quantity_g: t })}
                keyboardType="number-pad"
                placeholder="g"
                placeholderTextColor={Colors.outline}
                style={[s.cellInput, { flex: 1 }]}
              />
            </View>
            <View style={s.chipRow}>
              {PREP_METHODS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setRow(i, { prep_method: m })}
                  style={[s.chipSm, row.prep_method === m && s.chipActive]}
                >
                  <Text style={[s.chipTextSm, row.prep_method === m && s.chipTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Pressable onPress={addRow} style={s.addRow} accessibilityRole="button">
          <Icons.Plus size={16} color={Colors.secondary} strokeWidth={2.4} />
          <Text style={s.addText}>Add ingredient</Text>
        </Pressable>
      </ScrollView>

      <View style={s.footer}>
        <PrimaryButton
          label="Save recipe"
          onPress={onSave}
          loading={declare.isPending}
          disabled={!valid}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  inputWrap: {
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
  input: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  unit: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSm: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextSm: { ...Typography.caption, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { ...Typography.labelMd, color: Colors.onSurface },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
  cellInput: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.sm,
    height: 44,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: Spacing.sm },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  footer: {
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
