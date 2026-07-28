import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle, Plus, X, Flag, ShieldAlert, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useDiscussions, useCreateDiscussion, useReportContent } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';
import type { Discussion, ReportReason } from '@/features/academy/types';

const ROLE_META: Record<Discussion['authorRole'], { color: string; bg: string }> = {
  tutor:  { color: Colors.primary,   bg: Colors.iconBgPurple },
  mentor: { color: Colors.teal,      bg: Colors.iconBgTeal },
  peer:   { color: Colors.secondary, bg: Colors.iconBgBlue },
};

/** C5 — Discussion / Q&A (moderated). Report → POST /moderation/report. */
export default function DiscussionsScreen() {
  const discussions = useDiscussions();
  const create = useCreateDiscussion();
  const report = useReportContent();
  const [composing, setComposing] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');

  if (discussions.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading discussions…" /></SafeAreaView>;

  const onPost = () => {
    if (!title.trim()) return;
    create.mutate({ scope: 'General', title: title.trim(), body: body.trim() }, {
      onSuccess: () => { setComposing(false); setTitle(''); setBody(''); },
    });
  };

  const onReport = (d: Discussion) => {
    const reason: ReportReason = 'unsafe';
    report.mutate({ targetKind: 'discussion', targetId: d.id, reason });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Discussion & Q&A"
        subtitle="Moderated · group only"
        rightSlot={<Pressable hitSlop={8} onPress={() => setComposing((c) => !c)}>{composing ? <X size={20} color={Colors.onSurface} /> : <Plus size={20} color={Colors.onSurface} />}</Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {composing ? (
          <View style={[styles.composeCard, shadow1]}>
            <Text style={styles.composeTitle}>Ask a question</Text>
            <TextInput style={styles.input} placeholder="Title" placeholderTextColor={Colors.onSurfaceVariant} value={title} onChangeText={setTitle} />
            <TextInput style={[styles.input, styles.multiline]} placeholder="Details (optional)" placeholderTextColor={Colors.onSurfaceVariant} value={body} onChangeText={setBody} multiline />
            <Text style={styles.modNote}>Posts pass moderation before they appear publicly.</Text>
            <PrimaryButton label="Post question" onPress={onPost} loading={create.isPending} disabled={!title.trim()} />
          </View>
        ) : null}

        {discussions.data?.map((d) => (
          <View key={d.id} style={[styles.card, shadow1]}>
            <View style={styles.top}>
              <View style={styles.icon}><MessageCircle size={18} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{d.title}</Text>
                <View style={styles.metaRow}>
                  <Chip label={d.authorRole} color={ROLE_META[d.authorRole].color} bg={ROLE_META[d.authorRole].bg} small />
                  <Text style={styles.author}>{d.authorName} · {d.scope}</Text>
                </View>
              </View>
            </View>
            {d.body ? <Text style={styles.body} numberOfLines={3}>{d.body}</Text> : null}
            <View style={styles.footer}>
              {d.moderation === 'pending_review' ? (
                <View style={styles.modPill}><Clock size={12} color={Colors.onWarning} /><Text style={styles.modPillText}>Pending review</Text></View>
              ) : d.moderation === 'removed' ? (
                <View style={styles.modPill}><ShieldAlert size={12} color={Colors.error} /><Text style={[styles.modPillText, { color: Colors.error }]}>Removed</Text></View>
              ) : (
                <Text style={styles.replies}>{d.replyCount} repl{d.replyCount === 1 ? 'y' : 'ies'} · {formatDate(d.ts)}</Text>
              )}
              <Pressable hitSlop={8} style={styles.reportBtn} onPress={() => onReport(d)} disabled={d.reported}>
                <Flag size={13} color={d.reported ? Colors.teal : Colors.onSurfaceVariant} />
                <Text style={[styles.reportText, d.reported && { color: Colors.teal }]}>{d.reported ? 'Reported' : 'Report'}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  composeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  composeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 44, color: Colors.onSurface, ...Typography.bodyMd },
  multiline: { height: 88, paddingTop: Spacing.sm, textAlignVertical: 'top' },
  modNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 6 },
  top: { flexDirection: 'row', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  author: { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1 },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  replies: { ...Typography.caption, color: Colors.onSurfaceVariant },
  modPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modPillText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reportText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' },
});
