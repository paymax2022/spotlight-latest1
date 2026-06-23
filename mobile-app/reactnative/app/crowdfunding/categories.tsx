import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCategories } from '@/features/crowdfunding/hooks/useCrowdfunding';
import type { CampaignCategory } from '@/features/crowdfunding/types/crowdfunding.types';

const TINT: Record<CampaignCategory['tint'], { fg: string; bg: string }> = {
  purple: { fg: Colors.primary,           bg: Colors.iconBgPurple },
  blue:   { fg: Colors.secondary,         bg: Colors.iconBgBlue },
  teal:   { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  orange: { fg: '#B65A00',                bg: Colors.iconBgOrange },
  green:  { fg: '#0F7A37',                bg: Colors.iconBgGreen },
  red:    { fg: Colors.error,             bg: Colors.iconBgRed },
};

export default function CategoriesScreen() {
  const { data, isLoading, isError, refetch } = useCategories();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="All causes" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load categories" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const tint = TINT[item.tint];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Folder;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => router.push(`/crowdfunding/campaigns?category=${item.slug}&title=${encodeURIComponent(item.label)}`)}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.campaignCount} campaigns`}
              >
                <View style={[styles.iconBox, { backgroundColor: tint.bg }]}>
                  <Icon size={22} color={tint.fg} strokeWidth={2} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.label}</Text>
                  <Text style={styles.rowCount}>{item.campaignCount.toLocaleString('en-NG')} active campaigns</Text>
                </View>
                <ChevronRight size={20} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 100, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  pressed: { opacity: 0.85 },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { ...Typography.titleMd, color: Colors.onSurface },
  rowCount: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
