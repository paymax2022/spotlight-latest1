import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProperty } from '@/features/stays/hooks';
import { AMENITIES, AMENITY_LABEL, StaysColors } from '@/features/stays/constants/stays.constants';

export default function AmenitiesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Amenities" subtitle={prop.data?.name} />
      {prop.isLoading ? (
        <StateView kind="loading" message="Loading amenities…" />
      ) : prop.isError || !prop.data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => prop.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {AMENITIES.map((a) => {
            const has = prop.data!.amenities.includes(a.key);
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[a.icon] ?? Icons.Check;
            return (
              <View key={a.key} style={styles.row}>
                <View style={[styles.iconBox, !has && styles.iconBoxOff]}>
                  <Icon size={18} color={has ? StaysColors.brand : Colors.outline} strokeWidth={2} />
                </View>
                <Text style={[styles.label, !has && styles.labelOff]}>{AMENITY_LABEL[a.key]}</Text>
                {has ? <Icons.Check size={18} color={StaysColors.ok} strokeWidth={2.4} /> : <Text style={styles.na}>Not available</Text>}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconBoxOff: { opacity: 0.5 },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  labelOff: { color: Colors.onSurfaceVariant },
  na: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
