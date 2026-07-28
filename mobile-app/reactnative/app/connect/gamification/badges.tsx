import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useBadges } from '@/features/connect/gamification/hooks';
import type { Badge } from '@/features/connect/gamification/types';

function pascal(kebab: string): string {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

const RARITY_COLOR: Record<Badge['rarity'], string> = {
  common: Colors.outline,
  rare: Colors.secondary,
  epic: ConnectColors.brand,
  legendary: ConnectColors.warn,
};

/** Achievements gallery (PRD §10.10 GM-07): earned badges. */
export default function BadgesScreen() {
  const q = useBadges();
  const badges = q.data ?? [];
  const earned = badges.filter((b) => b.earned).length;

  function renderItem({ item }: { item: Badge }) {
    const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[pascal(item.icon)] ?? Icons.Award;
    return (
      <View style={[styles.card, !item.earned && styles.cardLocked]}>
        <View style={[styles.iconWrap, { borderColor: item.earned ? RARITY_COLOR[item.rarity] : Colors.outlineVariant }]}>
          {item.earned ? (
            <IconCmp size={28} color={RARITY_COLOR[item.rarity]} strokeWidth={2} />
          ) : (
            <Lock size={22} color={Colors.onSurfaceVariant} strokeWidth={2} />
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
        <Text style={[styles.rarity, { color: RARITY_COLOR[item.rarity] }]}>{item.rarity}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Badges" subtitle={badges.length ? `${earned} of ${badges.length} earned` : 'Achievements'} />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading badges…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load badges" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : badges.length === 0 ? (
        <StateView kind="empty" icon="Award" title="No badges yet" message="Complete missions and milestones to earn badges." />
      ) : (
        <FlatList
          data={badges}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin },
  col: { gap: Spacing.md },
  card: { flex: 1, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md, alignItems: 'center', gap: 4 },
  cardLocked: { opacity: 0.7 },
  iconWrap: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, marginBottom: 4 },
  name: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const, textAlign: 'center' },
  desc: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  rarity: { ...Typography.labelSm, fontWeight: '700' as const, textTransform: 'capitalize' as const, marginTop: 2 },
});
