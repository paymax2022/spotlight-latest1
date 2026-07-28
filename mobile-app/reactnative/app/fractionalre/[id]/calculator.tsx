import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOffering } from '@/features/fractionalre/hooks';
import ReturnsCalculator from '@/features/fractionalre/components/ReturnsCalculator';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function CalculatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offering = useOffering(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Returns calculator" subtitle={offering.data?.title} />
      {offering.isLoading || !offering.data ? (
        <StateView kind="loading" message="Loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ReturnsCalculator offering={offering.data} editable />
          <RiskRibbon compact />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
});
