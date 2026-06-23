import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useModules } from '@/features/merchant/hooks/useMerchant';

// Screen: Module picker (FR-5) — only modules open for onboarding are tappable.
export default function ModulePickerScreen() {
  const { data, isLoading, isError, refetch } = useModules();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose a module" subtitle="Where do you want to provide a service?" />

      {isLoading && !data ? (
        <StateView kind="loading" message="Loading modules" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load modules" actionLabel="Retry" onAction={() => refetch()} />
      ) : data.length === 0 ? (
        <StateView kind="empty" icon="LayoutGrid" title="No modules open" message="Onboarding is closed right now. Please check back soon." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {data.map((mod) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[mod.icon] ?? Icons.LayoutGrid;
            const open = mod.status === 'open';
            return (
              <Pressable
                key={mod.id}
                disabled={!open}
                onPress={() => router.push(`/(merchant)/types?moduleId=${mod.id}`)}
                style={({ pressed }) => [styles.card, shadow1, !open && styles.cardClosed, pressed && open && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !open }}
                accessibilityLabel={`${mod.name}. ${open ? `${mod.typeCount} provider types` : 'Closed for onboarding'}`}
              >
                <View style={[styles.iconBox, { backgroundColor: mod.bgColor }]}>
                  <Icon size={22} color={mod.iconColor} strokeWidth={1.8} />
                </View>
                <View style={styles.body}>
                  <Text style={styles.name}>{mod.name}</Text>
                  <Text style={styles.desc} numberOfLines={2}>{mod.description}</Text>
                  <Text style={styles.meta}>{open ? `${mod.typeCount} provider type${mod.typeCount === 1 ? '' : 's'}` : 'Closed for onboarding'}</Text>
                </View>
                {open
                  ? <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
                  : <Lock size={16} color={Colors.outline} strokeWidth={1.8} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  card:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  cardClosed: { opacity: 0.6 },
  pressed:    { opacity: 0.85 },
  iconBox:    { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body:       { flex: 1, gap: 2 },
  name:       { ...Typography.titleMd, color: Colors.onSurface },
  desc:       { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta:       { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
});
