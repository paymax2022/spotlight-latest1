import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send, UserRound, HelpCircle, Flag, CornerDownRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/features/crowdfunding/components/SegmentedTabs';
import { useComments, usePostComment, useReplyComment, useReportComment } from '@/features/crowdfunding/hooks/useExtras';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'questions', label: 'Questions' },
];

export default function CommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useComments(id);
  const post = usePostComment(id);
  const reply = useReplyComment(id);
  const report = useReportComment(id);

  const [tab, setTab] = useState('all');
  const [text, setText] = useState('');
  const [asQuestion, setAsQuestion] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);

  const filtered = (data ?? []).filter((c) => tab === 'all' || c.isQuestion);

  const send = () => {
    if (!text.trim()) return;
    if (replyTo) reply.mutate({ commentId: replyTo.id, body: text.trim() });
    else post.mutate({ body: text.trim(), isQuestion: asQuestion });
    setText('');
    setReplyTo(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Comments & Q&A" />
      <View style={styles.tabs}><SegmentedTabs options={TABS} value={tab} onChange={setTab} /></View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {isLoading ? (
          <StateView kind="loading" />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load comments" actionLabel="Retry" onAction={refetch} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <View style={styles.row}>
                  <View style={styles.avatar}><UserRound size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
                  <View style={styles.body}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>{item.authorName}</Text>
                      {item.isQuestion && <View style={styles.qChip}><HelpCircle size={11} color={Colors.secondary} strokeWidth={2.2} /><Text style={styles.qText}>Question</Text></View>}
                      <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                    </View>
                    <Text style={styles.text}>{item.body}</Text>
                    <View style={styles.actions}>
                      <Pressable onPress={() => setReplyTo({ id: item.id, name: item.authorName })} hitSlop={6}><Text style={styles.actionText}>Reply</Text></Pressable>
                      <Pressable onPress={() => report.mutate(item.id)} hitSlop={6} disabled={item.reported}>
                        <Text style={[styles.actionText, item.reported && styles.reported]}>{item.reported ? 'Reported' : 'Report'}</Text>
                      </Pressable>
                    </View>
                  </View>
                  {item.reported && <Flag size={13} color={Colors.error} strokeWidth={2} />}
                </View>

                {/* Replies */}
                {item.replies.map((r) => (
                  <View key={r.id} style={styles.reply}>
                    <CornerDownRight size={14} color={Colors.outline} strokeWidth={2} />
                    <View style={[styles.replyBubble, r.isCreator && styles.replyBubbleCreator]}>
                      <View style={styles.nameRow}>
                        <Text style={styles.replyName}>{r.authorName}</Text>
                        {r.isCreator && <View style={styles.creatorChip}><Text style={styles.creatorChipText}>Creator</Text></View>}
                        <Text style={styles.time}>{relativeTime(r.createdAt)}</Text>
                      </View>
                      <Text style={styles.replyText}>{r.body}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={<StateView kind="empty" icon="MessageCircle" title="No comments yet" message="Be the first to leave a comment or ask a question." />}
          />
        )}

        {/* Composer */}
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyingTo}>
              <Text style={styles.replyingText}>Replying to {replyTo.name}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={6}><Text style={styles.cancelReply}>Cancel</Text></Pressable>
            </View>
          ) : (
            <Pressable style={styles.qToggle} onPress={() => setAsQuestion((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: asQuestion }}>
              <View style={[styles.qBox, asQuestion && styles.qBoxOn]}>{asQuestion && <HelpCircle size={12} color={Colors.onPrimary} strokeWidth={2.4} />}</View>
              <Text style={styles.qToggleText}>Ask as a question</Text>
            </Pressable>
          )}
          <View style={styles.inputRow}>
            <TextInput style={styles.input} placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'} placeholderTextColor={Colors.outline} value={text} onChangeText={setText} multiline />
            <Pressable style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]} onPress={send} disabled={!text.trim() || post.isPending || reply.isPending} accessibilityLabel="Send">
              <Send size={18} color={Colors.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  tabs: { paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, flexGrow: 1 },
  comment: { paddingVertical: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  avatar: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  qChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  qText: { ...Typography.caption, color: Colors.secondary, fontWeight: '600' as const },
  time: { ...Typography.caption, color: Colors.outline },
  text: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  actionText: { ...Typography.labelSm, color: Colors.secondary },
  reported: { color: Colors.error },
  reply: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.sm, marginLeft: Spacing.xl },
  replyBubble: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  replyBubbleCreator: { backgroundColor: Colors.primaryFixed },
  replyName: { ...Typography.labelSm, color: Colors.onSurface },
  creatorChip: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  creatorChipText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '600' as const },
  replyText: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 2 },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  composer: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, backgroundColor: Colors.background, gap: Spacing.xs },
  replyingTo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  replyingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cancelReply: { ...Typography.labelSm, color: Colors.secondary },
  qToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qBox: { width: 18, height: 18, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  qBoxOn: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  qToggleText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.bodyMd, color: Colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
});
