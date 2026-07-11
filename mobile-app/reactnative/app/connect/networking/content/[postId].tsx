import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import {
  ThumbsUp,
  PartyPopper,
  Heart,
  Lightbulb,
  HelpCircle,
  MessageCircle,
  Repeat2,
  ShieldCheck,
  Send,
  Building2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { usePost, useReactToPost, useCommentOnPost } from '@/features/connect/networking/content/hooks';
import type { ReactionType, PostComment, PostAuthor } from '@/features/connect/networking/content/types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

const REACTIONS: { type: ReactionType; label: string; Icon: typeof ThumbsUp }[] = [
  { type: 'like', label: 'Like', Icon: ThumbsUp },
  { type: 'celebrate', label: 'Celebrate', Icon: PartyPopper },
  { type: 'support', label: 'Support', Icon: Heart },
  { type: 'insightful', label: 'Insightful', Icon: Lightbulb },
  { type: 'curious', label: 'Curious', Icon: HelpCircle },
];

/** Post detail — reactions + comments + reshare count (PRD §6.2 CN-02). */
export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const id = String(postId ?? '');
  const postQuery = usePost(id);
  const react = useReactToPost(id);
  const comment = useCommentOnPost(id);

  const [draft, setDraft] = useState('');
  const data = postQuery.data;

  function onComment() {
    const body = draft.trim();
    if (!body) return;
    comment.mutate(body, { onSuccess: () => setDraft('') });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Post" />
      {postQuery.isLoading ? (
        <StateView kind="loading" message="Loading post…" />
      ) : postQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load post"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => postQuery.refetch()}
        />
      ) : !data ? (
        <StateView kind="empty" icon="MessageSquare" title="Post not found" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <AuthorRow author={data.post.author} time={relativeTime(data.post.createdAt)} verified={data.post.verifiedOutcome} />

            <Text style={styles.body}>{data.post.body}</Text>

            {data.post.hashtags.length ? (
              <View style={styles.tags}>
                <DiscoveryChipRow items={data.post.hashtags.map((t) => `#${t}`)} variant="static" />
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{data.post.reactionCount} reactions</Text>
              <View style={styles.metaDot} />
              <Text style={styles.metaText}>{data.post.commentCount} comments</Text>
              <View style={styles.metaDot} />
              <View style={styles.metaInline}>
                <Repeat2 size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.metaText}>{data.post.reshareCount}</Text>
              </View>
            </View>

            {/* Reaction bar */}
            <View style={styles.reactionBar}>
              {REACTIONS.map(({ type, label, Icon }) => {
                const active = data.post.viewerReaction === type;
                return (
                  <Pressable
                    key={type}
                    style={[styles.reactionBtn, active && styles.reactionBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    disabled={react.isPending}
                    onPress={() => react.mutate(type)}
                  >
                    <Icon
                      size={16}
                      color={active ? ConnectColors.brand : Colors.onSurfaceVariant}
                      strokeWidth={2.2}
                    />
                    <Text style={[styles.reactionLabel, active && styles.reactionLabelActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Comments */}
            <View style={styles.commentsHeader}>
              <MessageCircle size={16} color={Colors.onSurface} strokeWidth={2} />
              <Text style={styles.commentsTitle}>Comments</Text>
            </View>

            {data.comments.length === 0 ? (
              <StateView
                kind="empty"
                icon="MessageCircle"
                title="No comments yet"
                message="Be the first to add to the conversation."
                compact
              />
            ) : (
              <View style={styles.comments}>
                {data.comments.map((c) => (
                  <CommentRow key={c.id} comment={c} />
                ))}
              </View>
            )}

            <View style={{ height: Spacing.xxl }} />
          </ScrollView>

          {/* Comment composer */}
          <View style={styles.composer}>
            <View style={styles.composerInput}>
              <TextInputField
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment…"
                multiline
                maxLength={1000}
              />
            </View>
            <Pressable
              style={[styles.sendBtn, (!draft.trim() || comment.isPending) && styles.sendBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
              disabled={!draft.trim() || comment.isPending}
              onPress={onComment}
            >
              <Send size={18} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function AuthorRow({ author, time, verified }: { author: PostAuthor; time: string; verified: boolean }) {
  const isCompany = author.type === 'companyPage';
  return (
    <View style={styles.authorRow}>
      <View style={[styles.avatar, isCompany && styles.avatarCompany]}>
        {isCompany ? (
          <Building2 size={20} color={ConnectColors.brand} strokeWidth={2} />
        ) : (
          <Text style={styles.avatarInitial}>{author.name.charAt(0)}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.authorName} numberOfLines={1}>{author.name}</Text>
          {verified ? <ShieldCheck size={14} color={ConnectColors.ok} strokeWidth={2.4} /> : null}
        </View>
        {author.headline ? <Text style={styles.authorHeadline} numberOfLines={1}>{author.headline}</Text> : null}
      </View>
      <Text style={styles.time}>{time}</Text>
    </View>
  );
}

function CommentRow({ comment }: { comment: PostComment }) {
  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}>
        <Text style={styles.commentInitial}>{comment.author.name.charAt(0)}</Text>
      </View>
      <View style={styles.commentBubble}>
        <Text style={styles.commentName}>{comment.author.name}</Text>
        {comment.author.headline ? (
          <Text style={styles.commentHeadline} numberOfLines={1}>{comment.author.headline}</Text>
        ) : null}
        <Text style={styles.commentBody}>{comment.body}</Text>
        <Text style={styles.commentTime}>{relativeTime(comment.createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  avatarCompany: { borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal },
  avatarInitial: { ...Typography.titleMd, color: ConnectColors.brand, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  authorName: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', flexShrink: 1 },
  authorHeadline: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyLg, color: Colors.onSurface, marginTop: Spacing.md, lineHeight: 24 },
  tags: { marginTop: Spacing.md },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  metaInline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outlineVariant },
  reactionBar: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.md },
  reactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  reactionBtnActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  reactionLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  reactionLabelActive: { color: ConnectColors.brand, fontWeight: '700' },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  commentsTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  comments: { gap: Spacing.md },
  commentRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  commentInitial: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  commentBubble: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 2,
  },
  commentName: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  commentHeadline: { ...Typography.caption, color: Colors.onSurfaceVariant },
  commentBody: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 4 },
  commentTime: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  composerInput: { flex: 1 },
  sendBtn: {
    width: 48,
    height: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginBottom: Spacing.md,
  },
  sendBtnDisabled: { opacity: 0.5 },
});
