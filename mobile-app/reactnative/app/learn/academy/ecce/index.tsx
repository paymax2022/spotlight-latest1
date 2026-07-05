import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Settings, Star, Moon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { useEcceHome } from '@/features/academy/hooks';

const COLOR_KEY = (k: string) => (Colors as unknown as Record<string, string>)[k] ?? Colors.iconBgPurple;

/**
 * E1 — Kids home (Little Learners). Simplified, large-target, screen-light. The
 * settings cog is parent-gated (E3) so kids can't reach settings/purchases.
 */
export default function EcceHome() {
  const home = useEcceHome();
  if (home.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (!home.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Let’s try again" /></SafeAreaView>;

  const h = home.data;

  // Screen-light: when the daily play limit is reached, show a calm rest screen.
  if (h.dailyLimitReached) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.rest}>
          <Moon size={48} color={Colors.gold} />
          <Text style={styles.restTitle}>Time to rest your eyes</Text>
          <Text style={styles.restSub}>Great playing today, {h.childName}! Come back tomorrow for more.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={styles.greeting}>Hi {h.childName}! 👋</Text>
          {/* Parent-gated settings (E3) */}
          <Pressable
            style={styles.cog}
            accessibilityLabel="Grown-up settings"
            onPress={() => router.push('/learn/academy/ecce/gate?next=/learn/academy/parent')}
          >
            <Settings size={22} color={Colors.onSurfaceVariant} />
          </Pressable>
        </View>
        <Text style={styles.subhead}>What do you want to play?</Text>

        <View style={styles.grid}>
          {h.activities.map((a) => (
            <Pressable
              key={a.id}
              style={[styles.tile, { backgroundColor: COLOR_KEY(a.colorKey) }, shadow3]}
              accessibilityLabel={a.title}
              onPress={() => router.push(`/learn/academy/ecce/play/${a.id}`)}
            >
              <Text style={styles.tileEmoji}>{a.emoji}</Text>
              <Text style={styles.tileTitle}>{a.title}</Text>
              <View style={styles.stars}>
                {[0, 1, 2].map((i) => (
                  <Star key={i} size={16} color={Colors.gold} fill={i < a.stars ? Colors.gold : 'transparent'} />
                ))}
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.parentLink, shadow1]}
          onPress={() => router.push('/learn/academy/ecce/gate?next=/learn/academy/parent')}
        >
          <Settings size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.parentLinkText}>Grown-up area</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { ...Typography.displayLg, color: Colors.onSurface, fontSize: 30, lineHeight: 36 },
  cog: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  subhead: { ...Typography.titleLg, color: Colors.onSurfaceVariant },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tile: { width: '47%', flexGrow: 1, aspectRatio: 1, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md },
  tileEmoji: { fontSize: 56 },
  tileTitle: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700', textAlign: 'center' },
  stars: { flexDirection: 'row', gap: 4 },
  parentLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.full, paddingVertical: Spacing.md, marginTop: Spacing.sm },
  parentLinkText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rest: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  restTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  restSub: { ...Typography.bodyLg, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
