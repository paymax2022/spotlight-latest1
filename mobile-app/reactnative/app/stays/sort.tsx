import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import { useStaysStore } from '@/features/stays/store';
import { SORT_OPTIONS } from '@/features/stays/constants/stays.constants';
import type { SortKey } from '@/features/stays/types';

export default function SortScreen() {
  const { filter, setFilter } = useStaysStore();
  const current = filter.sort ?? 'top_picks';

  const pick = (s: SortKey) => {
    setFilter({ sort: s });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Sort by" />
      <View style={styles.list}>
        {SORT_OPTIONS.map((o) => {
          const on = o.value === current;
          return (
            <Pressable key={o.value} style={styles.row} onPress={() => pick(o.value)}>
              <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
              {on ? <Check size={20} color={Colors.primary} strokeWidth={2.4} /> : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  label: { ...Typography.bodyLg, color: Colors.onSurface },
  labelOn: { color: Colors.primary, fontWeight: '700' as const },
});
