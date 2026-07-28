import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Lock, Users, Check, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCommunities, useToggleJoinCommunity } from '@/features/connect/networking/hooks';
import type { Community } from '@/features/connect/networking/types';

/**
 * Communities directory (PRD §10.3 NW-05). Join/Leave toggles in place; cards
 * route to the detail feed.
 */
export default function CommunitiesScreen() {
  const [query, setQuery] = useState('');
  const communitiesQuery = useCommunities(query);
  const communities = communitiesQuery.data ?? [];

  function renderBody() {
    if (communitiesQuery.isLoading) {
      return <StateView kind="loading" message="Loading communities…" />;
    }
    if (communitiesQuery.isError) {
      return (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load communities"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => communitiesQuery.refetch()}
        />
      );
    }
    if (communities.length === 0) {
      return (
        <StateView
          kind="empty"
          icon="Users"
          title="No communities found"
          message="Try a different search, or start your own."
        />
      );
    }
    return (
      <View style={styles.list}>
        {communities.map((c) => (
          <CommunityCard key={c.id} community={c} />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Communities"
        rightSlot={
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Create community"
            onPress={() => router.push('/connect/networking/create-community')}
          >
            <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <SearchBar placeholder="Search communities…" value={query} onChangeText={setQuery} />
        {renderBody()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function CommunityCard({ community }: { community: Community }) {
  const toggle = useToggleJoinCommunity();
  const joined = community.joined;

  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/connect/networking/community-detail?id=${encodeURIComponent(community.id)}`)
      }
    >
      {community.coverUrl ? (
        <Image source={{ uri: community.coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Users size={26} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Text style={styles.name} numberOfLines={1}>{community.name}</Text>
          {community.isPrivate ? (
            <View style={styles.privateTag}>
              <Lock size={12} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
              <Text style={styles.privateText}>Private</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.metaLine}>
          {community.category} · {community.memberCount.toLocaleString('en-NG')} member
          {community.memberCount === 1 ? '' : 's'}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>{community.description}</Text>

        <Pressable
          style={[styles.joinBtn, joined ? styles.joinedBtn : styles.joinBtnActive]}
          accessibilityRole="button"
          disabled={toggle.isPending}
          onPress={() => toggle.mutate({ id: community.id, join: !joined })}
        >
          {joined ? (
            <>
              <CircleCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
              <Text style={[styles.joinText, { color: ConnectColors.ok }]}>Joined</Text>
            </>
          ) : (
            <>
              <Check size={15} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={[styles.joinText, { color: Colors.onPrimary }]}>Join</Text>
            </>
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 120, backgroundColor: Colors.surfaceContainerHigh },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: Spacing.cardPadding, gap: Spacing.xs },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
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
  metaLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  joinBtnActive: { backgroundColor: ConnectColors.brand },
  joinedBtn: { backgroundColor: Colors.iconBgTeal },
  joinText: { ...Typography.labelMd, fontWeight: '700' },
});
