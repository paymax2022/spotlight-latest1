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
import { useArenas } from '@/features/academy/hooks';
import { EXAM_META, daysUntil } from '@/features/academy/constants';

/** X1 — Arena hub. Choose CCE/BECE/WASSCE/NECO/UTME/NABTEB. */
export default function ArenaHub() {
  const arenas = useArenas();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Exam arenas" subtitle="The crown — beat the exam" />
      <OfflineBanner />
      {arenas.isLoading ? (
        <StateView kind="loading" message="Loading arenas…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {arenas.data?.map((a) => {
            const meta = EXAM_META[a.slug];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.GraduationCap;
            const days = daysUntil(a.nextSittingDate);
            return (
              <Pressable key={a.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/exam/${a.id}`)}>
                <View style={styles.cardTop}>
                  <View style={[styles.iconBox, { backgroundColor: meta.iconBg }]}>
                    <Icon size={24} color={meta.color} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{a.name}</Text>
                    <Text style={styles.cardSub}>{meta.full}{a.isCbt ? ' · CBT' : ''}</Text>
                  </View>
                  <View style={styles.countdown}>
                    <Text style={styles.countdownNum}>{days}</Text>
                    <Text style={styles.countdownLabel}>days</Text>
                  </View>
                </View>
                <View style={styles.readinessRow}>
                  <Text style={styles.readinessLabel}>Readiness {a.readinessPct}%</Text>
                  <ProgressBar pct={a.readinessPct} color={meta.color} style={{ marginTop: 4 }} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleLg, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  countdown: { alignItems: 'center' },
  countdownNum: { ...Typography.headlineMd, color: Colors.primary },
  countdownLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  readinessRow: { marginTop: Spacing.md },
  readinessLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
