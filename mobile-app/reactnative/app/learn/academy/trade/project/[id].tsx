import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Video, FileText, X, CheckCircle2, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useTradeProject, useSubmitProject } from '@/features/academy/hooks';

type Attach = { id: string; name: string; kind: 'photo' | 'video' | 'doc' };

/** S3 — Project/portfolio submission: mock upload → rubric grade. */
export default function TradeProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useTradeProject(id);
  const submit = useSubmitProject();
  const [attachments, setAttachments] = React.useState<Attach[]>([]);

  if (project.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading project…" /></SafeAreaView>;
  if (project.isError || !project.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Not found" message="This project is unavailable." /></SafeAreaView>;

  const p = project.data;
  const graded = p.status === 'graded' || p.status === 'submitted';

  // Mock "upload" — adds a fake attachment reference (no file picker dep).
  const addAttachment = (kind: Attach['kind']) => {
    const n = attachments.length + 1;
    setAttachments((a) => [...a, { id: `att_${Date.now()}_${n}`, name: `${kind}-${n}.${kind === 'video' ? 'mp4' : kind === 'doc' ? 'pdf' : 'jpg'}`, kind }]);
  };
  const removeAttachment = (aid: string) => setAttachments((a) => a.filter((x) => x.id !== aid));

  const onSubmit = () => submit.mutate({ projectId: p.id, input: { attachments } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Project submission" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{p.title}</Text>
        <View style={[styles.block, shadow1]}>
          <View style={styles.head}><ClipboardList size={16} color={Colors.primary} /><Text style={styles.headText}>Brief</Text></View>
          <Text style={styles.body}>{p.brief}</Text>
        </View>

        {/* Rubric */}
        <View style={[styles.block, shadow1]}>
          <Text style={styles.headText}>Rubric {graded && p.scorePct != null ? `· ${p.scorePct}%` : `(${p.rubric.reduce((s, r) => s + r.maxPoints, 0)} pts)`}</Text>
          {p.rubric.map((r) => (
            <View key={r.id} style={styles.rubricRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rubricLabel}>{r.label}</Text>
                {r.awardedPoints != null ? <ProgressBar pct={(r.awardedPoints / r.maxPoints) * 100} color={Colors.teal} height={6} style={{ marginTop: 4 }} /> : null}
              </View>
              <Text style={styles.rubricPts}>{r.awardedPoints != null ? `${r.awardedPoints}/${r.maxPoints}` : `${r.maxPoints} pts`}</Text>
            </View>
          ))}
        </View>

        {graded ? (
          <View style={[styles.graded, shadow1]}>
            <CheckCircle2 size={20} color={Colors.teal} />
            <View style={{ flex: 1 }}>
              <Text style={styles.gradedTitle}>Submitted{p.scorePct != null ? ` · scored ${p.scorePct}%` : ''}</Text>
              {p.feedback ? <Text style={styles.gradedBody}>{p.feedback}</Text> : null}
            </View>
          </View>
        ) : (
          <>
            {/* Mock uploader */}
            <View style={[styles.block, shadow1]}>
              <Text style={styles.headText}>Upload your work</Text>
              <Text style={styles.hint}>Add photos/video of your finished project. (Mock upload — no real file picker.)</Text>
              <View style={styles.uploadRow}>
                <Pressable style={styles.uploadBtn} onPress={() => addAttachment('photo')}><Camera size={18} color={Colors.primary} /><Text style={styles.uploadText}>Photo</Text></Pressable>
                <Pressable style={styles.uploadBtn} onPress={() => addAttachment('video')}><Video size={18} color={Colors.primary} /><Text style={styles.uploadText}>Video</Text></Pressable>
                <Pressable style={styles.uploadBtn} onPress={() => addAttachment('doc')}><FileText size={18} color={Colors.primary} /><Text style={styles.uploadText}>Doc</Text></Pressable>
              </View>
              {attachments.map((a) => (
                <View key={a.id} style={styles.attachRow}>
                  <FileText size={14} color={Colors.onSurfaceVariant} />
                  <Text style={styles.attachName} numberOfLines={1}>{a.name}</Text>
                  <Pressable hitSlop={8} onPress={() => removeAttachment(a.id)}><X size={16} color={Colors.onSurfaceVariant} /></Pressable>
                </View>
              ))}
            </View>
            <PrimaryButton label="Submit for grading" onPress={onSubmit} loading={submit.isPending} disabled={!attachments.length} />
            {submit.isError ? <Text style={styles.err}>{(submit.error as Error).message}</Text> : null}
          </>
        )}

        {graded ? <PrimaryButton label="Back to track" onPress={() => router.replace('/learn/academy/trade')} variant="secondary" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  block: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rubricRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rubricLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  rubricPts: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '700' },
  uploadRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  uploadBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.md, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md },
  uploadText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  attachName: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  graded: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  gradedTitle: { ...Typography.titleMd, color: Colors.onSurface },
  gradedBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  err: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
