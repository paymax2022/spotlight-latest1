import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { useDataSaverPrefs, useUpdateDataSaverPrefs } from '@/features/connect/hooks/useConnect';
import type { DataSaverLevel } from '@/features/connect/types/connect.types';

// ST-12 — Data-saver settings. Quality/data controls (low-bandwidth aware).
const LEVELS: { value: DataSaverLevel; title: string; sub: string }[] = [
  { value: 'off', title: 'Off', sub: 'Best quality, uses the most data' },
  { value: 'standard', title: 'Standard', sub: 'Balanced quality and data use' },
  { value: 'aggressive', title: 'Data saver', sub: 'Lowest data — ideal on slow networks' },
];

export default function DataSaver() {
  const { data, isLoading, error, refetch } = useDataSaverPrefs();
  const update = useUpdateDataSaverPrefs();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Data saver" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.group}>Data usage</Text>
          {LEVELS.map((l) => {
            const active = data.level === l.value;
            return (
              <Pressable
                key={l.value}
                style={[styles.levelCard, active && styles.levelCardActive]}
                onPress={() => update.mutate({ level: l.value })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.levelTitle}>{l.title}</Text>
                  <Text style={styles.levelSub}>{l.sub}</Text>
                </View>
                <View style={[styles.radio, active && styles.radioActive]} />
              </Pressable>
            );
          })}

          <Text style={styles.group}>Media</Text>
          <View style={styles.card}>
            <ToggleRow label="Autoplay videos" value={data.autoplayVideos} onValueChange={(v) => update.mutate({ autoplayVideos: v })} divider />
            <ToggleRow label="HD media" sub="Load high-resolution photos and streams" value={data.hdMedia} onValueChange={(v) => update.mutate({ hdMedia: v })} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg },
  levelCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  levelCardActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  levelTitle: { ...Typography.titleMd, color: Colors.onSurface },
  levelSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  radio: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  radioActive: { borderColor: Colors.primary, borderWidth: 7 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
});
