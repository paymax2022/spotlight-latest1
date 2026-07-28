import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Spacing } from '@/constants/spacing';
import { useDishNutrition } from '../hooks';
import NutritionCard from './NutritionCard';
import AllergenNotice from './AllergenNotice';

interface Props {
  dishId: string;
  /** Compact dish-row variant: a one-line card + an allergen chip strip. */
  compact?: boolean;
}

/**
 * Self-contained buyer block that fetches a dish's resolved nutrition + allergen
 * data and renders the honest card together with the (visually separate)
 * allergen notice. Drop it under a dish row or into a dish detail.
 */
export default function DishNutritionBlock({ dishId, compact }: Props) {
  const { data, isLoading, isError } = useDishNutrition(dishId);
  // Silent on loading/error in the buyer feed — never block the menu.
  if (isLoading || isError || !data) return null;

  if (compact) {
    return (
      <View style={styles.compact}>
        <NutritionCard profile={data} compact />
        <AllergenNotice allergens={data.allergens} />
      </View>
    );
  }

  return (
    <View style={styles.full}>
      <NutritionCard profile={data} />
      <AllergenNotice allergens={data.allergens} />
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { gap: Spacing.sm, marginTop: Spacing.sm },
  full: { gap: Spacing.md },
});
