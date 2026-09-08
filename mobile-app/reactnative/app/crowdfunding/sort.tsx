import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SORT_OPTIONS } from '@/features/crowdfunding/constants/crowdfunding.constants';

export default function SortScreen() {
  const params = useLocalSearchParams<Record<string, string>>();
  const current = params.sort ?? 'recommended';

  const apply = (sort: string) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null) as [string, string][],
    );
    next.set('sort', sort);
    router.replace(`/crowdfunding/campaigns?${next.toString()}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <Text style={styles.title}>Sort by</Text>
        <Pressable onPress={() => goBack('/crowdfunding')} hitSlop={10} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.list}>
        {SORT_OPTIONS.map((opt) => {
          const active = opt.value === current;
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[opt.icon] ?? Icons.ArrowUpDown;
          return (
            <Pressable
              key={opt.value}
              onPress={() => apply(opt.value)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.iconBox, active && styles.iconBoxActive]}>
                <Icon size={18} color={active ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2} />
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
              {active && <Check size={20} color={Colors.secondary} strokeWidth={2.4} />}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  grabber: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.containerMargin },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.7 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: Colors.primary },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  labelActive: { color: Colors.onSurface, fontWeight: '600' as const },
});
