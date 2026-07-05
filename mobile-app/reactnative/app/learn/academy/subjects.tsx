import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useSubjects } from '@/features/academy/hooks';

/** L3 — My subjects. Grid with progress rings (bars here, no SVG dep). */
export default function SubjectsScreen() {
  const subjects = useSubjects();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My subjects" subtitle="Tap a subject to see topics" />
      <OfflineBanner />
      {subjects.isLoading ? (
        <StateView kind="loading" message="Loading subjects…" />
      ) : subjects.isError ? (
        <StateView kind="error" title="Couldn’t load subjects" actionLabel="Retry" onAction={() => subjects.refetch()} />
      ) : !subjects.data?.length ? (
        <StateView kind="empty" title="No subjects yet" message="Finish onboarding to pick your class." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.grid}>
            {subjects.data.map((s) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[s.icon] ?? Icons.BookOpen;
              const bg = (Colors as unknown as Record<string, string>)[s.colorKey] ?? Colors.iconBgPurple;
              return (
                <Pressable key={s.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/subject/${s.id}`)}>
                  <View style={[styles.iconBox, { backgroundColor: bg }]}>
                    <Icon size={22} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={styles.name} numberOfLines={2}>{s.name}</Text>
                  <Text style={styles.meta}>{s.masteredTopics}/{s.topicCount} topics mastered</Text>
                  <ProgressBar pct={s.progressPct} style={{ marginTop: 8 }} />
                  <Text style={styles.pct}>{s.progressPct}%</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  pct: { ...Typography.labelSm, color: Colors.primary, marginTop: 4, alignSelf: 'flex-end' },
});
