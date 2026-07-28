import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Lock, Users, Check, CircleCheck, ThumbsUp, Rss } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCommunity, useToggleJoinCommunity } from '@/features/connect/networking/hooks';
import type { CommunityPost } from '@/features/connect/networking/types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/** Community detail + post feed (PRD §10.3 NW-06). */
export default function CommunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const communityId = String(id ?? '');
  const detailQuery = useCommunity(communityId);
  const toggle = useToggleJoinCommunity();

  const data = detailQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Community" />
      {detailQuery.isLoading ? (
        <StateView kind="loading" message="Loading community…" />
      ) : detailQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load community"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => detailQuery.refetch()}
        />
      ) : !data ? (
        <StateView kind="empty" icon="Users" title="Community not found" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {data.community.coverUrl ? (
            <Image source={{ uri: data.community.coverUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Users size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            </View>
          )}

          <View style={styles.headBlock}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{data.community.name}</Text>
              {data.community.isPrivate ? (
                <View style={styles.privateTag}>
                  <Lock size={12} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
                  <Text style={styles.privateText}>Private</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.meta}>
              {data.community.category} · {data.community.memberCount.toLocaleString('en-NG')} member
              {data.community.memberCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.desc}>{data.community.description}</Text>

            <Pressable
              style={[styles.joinBtn, data.community.joined ? styles.joinedBtn : styles.joinBtnActive]}
              accessibilityRole="button"
              disabled={toggle.isPending}
              onPress={() => toggle.mutate({ id: data.community.id, join: !data.community.joined })}
            >
              {data.community.joined ? (
                <>
                  <CircleCheck size={16} color={ConnectColors.ok} strokeWidth={2.2} />
                  <Text style={[styles.joinText, { color: ConnectColors.ok }]}>Joined</Text>
                </>
              ) : (
                <>
                  <Check size={16} color={Colors.onPrimary} strokeWidth={2.2} />
                  <Text style={[styles.joinText, { color: Colors.onPrimary }]}>Join community</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.feedHeader}>
            <Rss size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.feedTitle}>Recent posts</Text>
          </View>

          {data.posts.length === 0 ? (
            <StateView kind="empty" icon="Rss" title="No posts yet" message="Be the first to post." compact />
          ) : (
            <View style={styles.posts}>
              {data.posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PostCard({ post }: { post: CommunityPost }) {
  return (
    <View style={styles.post}>
      <View style={styles.postHead}>
        {post.authorAvatar ? (
          <Image source={{ uri: post.authorAvatar }} style={styles.postAvatar} />
        ) : (
          <View style={[styles.postAvatar, styles.postAvatarFallback]}>
            <Users size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthor}>{post.authorName}</Text>
          <Text style={styles.postTime}>{relativeTime(post.createdAt)}</Text>
        </View>
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      <View style={styles.postFooter}>
        <View style={styles.postStat}>
          <ThumbsUp size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.postStatText}>{post.likes}</Text>
        </View>
        <View style={styles.postStat}>
          <Rss size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.postStatText}>{post.comments} comments</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg },
  cover: { width: '100%', height: 160, backgroundColor: Colors.surfaceContainerHigh },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  headBlock: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, gap: Spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.headlineMd, color: Colors.onSurface, flex: 1 },
  privateTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  privateText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: 2 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 11,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  joinBtnActive: { backgroundColor: ConnectColors.brand },
  joinedBtn: { backgroundColor: Colors.iconBgTeal },
  joinText: { ...Typography.labelMd, fontWeight: '700' },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  feedTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  posts: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  post: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  postAvatar: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  postAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  postAuthor: { ...Typography.labelLg, color: Colors.onSurface },
  postTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  postBody: { ...Typography.bodyMd, color: Colors.onSurface },
  postFooter: { flexDirection: 'row', gap: Spacing.lg, marginTop: 2 },
  postStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postStatText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
