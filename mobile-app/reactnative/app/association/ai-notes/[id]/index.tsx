import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Sparkles, Gavel, ListChecks, AlertCircle, Wallet, Users, Check, Pencil, ArrowRightCircle, RefreshCw, FileDown, Share2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import PrimaryButton from '@/components/PrimaryButton';
import { useAiNote, useApproveAiNote, usePublishAiNote, useConvertActionItem, useRegenerateSummary } from '@/features/association/hooks/useAiNotes';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import { AI_REVIEW_SEGMENTS, AI_STATUS_STYLE } from '@/features/association/constants/ainotes.constants';
import type { AiNoteStatus } from '@/features/association/types/ainotes.types';

export default function AiNoteReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useAiNote(id);
  const approve = useApproveAiNote();
  const publish = usePublishAiNote();
  const convert = useConvertActionItem(id as string);
  const regen = useRegenerateSummary();

  const [tab, setTab] = useState<string>('summary');
  const [editing, setEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [converted, setConverted] = useState<Record<string, boolean>>({});

  if (note.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="AI minutes" />
        <StateView kind="loading" message="Loading minutes…" />
      </SafeAreaView>
    );
  }
  if (note.isError || !note.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="AI minutes" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => note.refetch()} />
      </SafeAreaView>
    );
  }

  const n = note.data;
  const liveStatus: AiNoteStatus = publish.isSuccess ? 'PUBLISHED' : approve.isSuccess ? 'APPROVED' : n.status;
  const st = AI_STATUS_STYLE[liveStatus];
  const summary = summaryDraft ?? n.summary;
  const canApprove = liveStatus === 'READY';
  const canPublish = liveStatus === 'APPROVED';

  const onConvert = (actionItemId: string, title: string) => {
    convert.mutate(actionItemId, {
      onSuccess: () => {
        setConverted((c) => ({ ...c, [actionItemId]: true }));
        Alert.alert('Task created', `“${title}” was added to Tasks.`);
      },
      onError: () => Alert.alert('Could not convert', 'Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="AI minutes"
        subtitle={n.meetingTitle}
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => Alert.alert('Export PDF', 'PDF export is not available in this preview build.')} hitSlop={8} accessibilityLabel="Export PDF">
              <FileDown size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => Alert.alert('Share minutes', 'Sharing is not available in this preview build.')} hitSlop={8} accessibilityLabel="Share minutes">
              <Share2 size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <View style={styles.statusRow}>
        <View style={[styles.pill, { backgroundColor: st.bg }]}>
          <View style={[styles.dot, { backgroundColor: st.color }]} />
          <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
        </View>
        <View style={styles.aiTag}>
          <Sparkles size={12} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.aiTagText}>AI draft · review before publishing</Text>
        </View>
      </View>

      <View style={styles.segWrap}>
        <SegmentedControl options={AI_REVIEW_SEGMENTS as never} value={tab} onChange={setTab} scrollable />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {tab === 'summary' ? (
          <View style={[styles.card, shadow1]}>
            <View style={styles.cardHead}>
              <Sparkles size={15} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.cardTitle}>Executive summary</Text>
              <Pressable
                onPress={() => regen.mutate(n.id, { onSuccess: (r) => { setSummaryDraft(r.summary); setEditing(false); } })}
                hitSlop={8}
                disabled={regen.isPending}
                accessibilityLabel="Regenerate summary"
                style={styles.headRegen}
              >
                <RefreshCw size={15} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.headRegenText}>{regen.isPending ? 'Regenerating…' : 'Regenerate'}</Text>
              </Pressable>
              <Pressable onPress={() => setEditing((e) => !e)} hitSlop={8} accessibilityLabel="Edit summary">
                <Pencil size={15} color={Colors.secondary} strokeWidth={2} />
              </Pressable>
            </View>
            {editing ? (
              <TextInput
                style={styles.editor}
                value={summary}
                onChangeText={setSummaryDraft}
                multiline
                accessibilityLabel="Edit summary"
              />
            ) : (
              <Text style={styles.body}>{summary}</Text>
            )}
            {n.unresolved.length > 0 ? (
              <>
                <Text style={styles.subHead}>Unresolved</Text>
                {n.unresolved.map((u, i) => (
                  <View key={i} style={styles.bulletRow}><AlertCircle size={14} color={Colors.gold} strokeWidth={2} /><Text style={styles.bulletText}>{u}</Text></View>
                ))}
              </>
            ) : null}
            {n.financialCommitments.length > 0 ? (
              <>
                <Text style={styles.subHead}>Financial commitments</Text>
                {n.financialCommitments.map((f) => (
                  <View key={f.id} style={styles.finRow}>
                    <Wallet size={14} color={Colors.teal} strokeWidth={2} />
                    <Text style={styles.bulletText}>{f.label}</Text>
                    <Text style={styles.finAmount}>{formatNaira(f.amountKobo)}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {tab === 'minutes' ? (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.body}>{n.minutes}</Text>
          </View>
        ) : null}

        {tab === 'decisions' ? (
          <View style={styles.gap8}>
            {n.decisions.map((d) => (
              <View key={d.id} style={[styles.itemCard, shadow1]}>
                <Gavel size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.itemText}>{d.text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === 'actions' ? (
          <View style={styles.gap8}>
            {n.actionItems.map((a) => {
              const isConverted = a.convertedTaskId != null || converted[a.id];
              return (
                <View key={a.id} style={[styles.itemCard, shadow1]}>
                  <ListChecks size={16} color={Colors.secondary} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemText}>{a.title}</Text>
                    <Text style={styles.itemMeta}>{a.owner} · {a.dueLabel}</Text>
                  </View>
                  {isConverted ? (
                    <View style={styles.convertedChip}><Check size={12} color={Colors.teal} strokeWidth={2.6} /><Text style={styles.convertedText}>Task</Text></View>
                  ) : (
                    <Pressable onPress={() => onConvert(a.id, a.title)} hitSlop={6} style={styles.convertBtn} accessibilityRole="button" accessibilityLabel={`Convert ${a.title} to task`}>
                      <ArrowRightCircle size={14} color={Colors.onPrimary} strokeWidth={2.2} />
                      <Text style={styles.convertText}>To task</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

        {tab === 'people' ? (
          <View style={[styles.card, shadow1]}>
            <View style={styles.cardHead}>
              <Users size={15} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.cardTitle}>Attendance ({n.attendees.filter((a) => a.present).length}/{n.attendees.length})</Text>
            </View>
            {n.attendees.map((a) => (
              <View key={a.id} style={styles.attRow}>
                <View style={[styles.attDot, { backgroundColor: a.present ? Colors.teal : Colors.outline }]} />
                <Text style={styles.attName}>{a.name}</Text>
                <Text style={[styles.attStatus, { color: a.present ? Colors.teal : Colors.onSurfaceVariant }]}>{a.present ? 'Present' : 'Absent'}</Text>
              </View>
            ))}
            <Text style={styles.subHead}>Transcript preview</Text>
            <Text style={styles.transcript}>{n.transcriptPreview}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Approval / publish footer */}
      {liveStatus === 'PUBLISHED' ? (
        <View style={styles.footer}>
          <View style={styles.publishedRow}>
            <Check size={18} color={Colors.teal} strokeWidth={2.4} />
            <Text style={styles.publishedText}>Minutes published to members</Text>
          </View>
        </View>
      ) : (
        <View style={styles.footer}>
          {canApprove ? (
            <View style={styles.footerBtns}>
              <PrimaryButton label="Reject" variant="secondary" fullWidth={false} style={styles.footerBtn} onPress={() => router.replace('/association/ai-notes')} />
              <PrimaryButton label="Approve" fullWidth={false} style={styles.footerBtn} loading={approve.isPending} onPress={() => approve.mutate(n.id)} />
            </View>
          ) : (
            <PrimaryButton label="Publish minutes" loading={publish.isPending} disabled={!canPublish} onPress={() => publish.mutate(n.id)} />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headRegen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headRegenText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  aiTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiTagText: { ...Typography.caption, color: Colors.primary },
  segWrap: { paddingVertical: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  body: { ...Typography.bodyMd, color: Colors.onSurface },
  editor: { ...Typography.bodyMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, minHeight: 120, textAlignVertical: 'top' },
  subHead: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  bulletText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  finRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  finAmount: { ...Typography.labelMd, color: Colors.teal },
  gap8: { gap: Spacing.sm },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  itemText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  itemMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  convertBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  convertText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  convertedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  convertedText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  attRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  attDot: { width: 8, height: 8, borderRadius: Radius.full },
  attName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  attStatus: { ...Typography.labelSm },
  transcript: { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  footerBtns: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
  publishedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  publishedText: { ...Typography.labelMd, color: Colors.teal },
});
