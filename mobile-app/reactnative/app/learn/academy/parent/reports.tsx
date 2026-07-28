import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Download, Share2, Sparkles, Clock, BookOpen, Target } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useReports, useGenerateReport, useChildren } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';
import type { ProgressReport } from '@/features/academy/types';

/** P6 — Progress reports: weekly/termly, downloadable & shareable; generate on demand. */
export default function ReportsScreen() {
  const { minorId } = useLocalSearchParams<{ minorId?: string }>();
  const children = useChildren();
  const reports = useReports(minorId);
  const generate = useGenerateReport();

  const targetChild = minorId ?? children.data?.find((c) => c.linked)?.minorId;
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  const onGenerate = (period: 'weekly' | 'termly') => {
    if (!targetChild) return;
    generate.mutate({ minorId: targetChild, period }, { onSuccess: () => flash(`${period === 'weekly' ? 'Weekly' : 'Termly'} report generated`) });
  };

  if (reports.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading reports…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Progress reports" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Generate */}
        <View style={[styles.genCard, shadow1]}>
          <Text style={styles.genTitle}>Generate a new report</Text>
          <View style={styles.genRow}>
            <Pressable style={styles.genBtn} onPress={() => onGenerate('weekly')} disabled={generate.isPending || !targetChild}>
              <Sparkles size={16} color={Colors.primary} /><Text style={styles.genBtnText}>Weekly</Text>
            </Pressable>
            <Pressable style={styles.genBtn} onPress={() => onGenerate('termly')} disabled={generate.isPending || !targetChild}>
              <Sparkles size={16} color={Colors.primary} /><Text style={styles.genBtnText}>Termly</Text>
            </Pressable>
          </View>
        </View>

        {toast ? <Text style={styles.toast}>{toast}</Text> : null}

        <Text style={styles.section}>Available reports</Text>
        {reports.data?.length ? reports.data.map((r) => <ReportCard key={r.id} r={r} onAction={flash} />) : (
          <StateView kind="empty" icon="FileText" title="No reports yet" message="Generate a weekly or termly report above." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportCard({ r, onAction }: { r: ProgressReport; onAction: (m: string) => void }) {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.cardTop}>
        <View style={styles.icon}><FileText size={18} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{r.childName}</Text>
          <Text style={styles.cardSub}>{r.periodLabel} · {formatDate(r.generatedAt)}</Text>
        </View>
        <Chip label={r.period === 'weekly' ? 'Weekly' : 'Termly'} color={Colors.secondary} bg={Colors.iconBgBlue} small />
      </View>

      <View style={styles.metrics}>
        <Metric icon={Clock} value={`${Math.round(r.minutesStudied / 60)}h`} label="studied" />
        <Metric icon={BookOpen} value={`${r.lessonsCompleted}`} label="lessons" />
        <Metric icon={Target} value={`+${r.masteryGained}`} label="mastered" />
      </View>

      <View style={styles.highlights}>
        {r.highlights.map((h, i) => <Text key={i} style={styles.highlight}>• {h}</Text>)}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={() => onAction('Report downloaded')}>
          <Download size={15} color={Colors.primary} /><Text style={styles.actionText}>Download</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => onAction('Share link copied')}>
          <Share2 size={15} color={Colors.primary} /><Text style={styles.actionText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Clock; value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Icon size={15} color={Colors.onSurfaceVariant} />
      <Text style={styles.metricVal}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  genCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  genTitle: { ...Typography.titleMd, color: Colors.onSurface },
  genRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  genBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: 12 },
  genBtnText: { ...Typography.labelMd, color: Colors.primary },
  toast: { ...Typography.labelMd, color: Colors.teal, textAlign: 'center', fontWeight: '700' },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metrics: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: Spacing.sm, gap: 2 },
  metricVal: { ...Typography.titleMd, color: Colors.onSurface },
  metricLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  highlights: { gap: 2 },
  highlight: { ...Typography.bodySm, color: Colors.onSurface },
  actions: { flexDirection: 'row', gap: Spacing.lg, justifyContent: 'flex-end' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { ...Typography.labelMd, color: Colors.primary },
});
