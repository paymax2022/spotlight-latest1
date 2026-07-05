import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Hammer, ListChecks, Target } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useTradeModule } from '@/features/academy/hooks';
import { track as trackEvent } from '@/features/academy/analytics';

/** S2 — Trade lesson (practical/project-based). */
export default function TradeModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mod = useTradeModule(id);

  React.useEffect(() => { if (mod.data) trackEvent('lesson_started', { kind: 'trade_module', module: mod.data.id }); }, [mod.data]);

  if (mod.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading lesson…" /></SafeAreaView>;
  if (mod.isError || !mod.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Not found" message="This lesson is unavailable." /></SafeAreaView>;

  const m = mod.data;
  const cta = m.kind === 'project' && m.projectId
    ? { label: 'Start project submission', onPress: () => router.replace(`/learn/academy/trade/project/${m.projectId}`) }
    : m.kind === 'assessment' && m.assessmentId
      ? { label: 'Take skill assessment', onPress: () => router.replace(`/learn/academy/trade/assessment/${m.assessmentId}`) }
      : { label: 'Mark practical done', onPress: () => router.back() };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={m.title} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.metaRow}>
          <Chip label={m.kind} color={Colors.secondary} bg={Colors.iconBgBlue} small />
          <Text style={styles.meta}>{m.estMinutes} min</Text>
        </View>

        {/* Mock practical media placeholder */}
        <View style={[styles.media, shadow1]}>
          <Hammer size={36} color={Colors.onSurfaceVariant} />
          <Text style={styles.mediaText}>Practical walkthrough video</Text>
          <Text style={styles.mediaHint}>Low-data variant available · captions on</Text>
        </View>

        <View style={[styles.block, shadow1]}>
          <View style={styles.blockHead}><Target size={16} color={Colors.primary} /><Text style={styles.blockTitle}>What you will be able to do</Text></View>
          <Text style={styles.body}>{m.outcome}</Text>
        </View>

        <View style={[styles.block, shadow1]}>
          <View style={styles.blockHead}><ListChecks size={16} color={Colors.primary} /><Text style={styles.blockTitle}>Steps</Text></View>
          {['Watch the practical demo', 'Gather your tools/materials', 'Practise the steps hands-on', 'Capture photos/video of your work'].map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        <PrimaryButton label={cta.label} onPress={cta.onPress} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  media: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, paddingVertical: Spacing.xl, alignItems: 'center', gap: 6 },
  mediaText: { ...Typography.titleMd, color: Colors.onSurface },
  mediaHint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  block: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blockTitle: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  stepText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
