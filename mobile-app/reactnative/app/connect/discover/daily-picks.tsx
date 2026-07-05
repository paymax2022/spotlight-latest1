import React from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles, Heart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useDailyPicks, useSwipe } from '@/features/connect/discovery/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import type { DailyPick } from '@/features/connect/discovery/types';

/**
 * Daily picks (PRD §10.2 DC-07). Curated candidates with a reason. Liking still
 * routes through a mutual match before any chat (SAFETY §4).
 */
export default function DailyPicksScreen() {
  const picksQuery = useDailyPicks();
  const swipe = useSwipe();
  const picks = picksQuery.data ?? [];

  function onLike(pick: DailyPick) {
    swipe.mutate(
      { profileId: pick.profile.id, action: 'like' },
      {
        onSuccess: (result) => {
          if (result.matched) {
            router.push({
              pathname: '/connect/discover/match-modal',
              params: {
                matchId: result.matchId ?? '',
                threadId: result.threadId ?? '',
                profileId: pick.profile.id,
                name: pick.profile.displayName,
              },
            });
          }
        },
      },
    );
  }

  function renderItem({ item }: { item: DailyPick }) {
    return (
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${item.profile.displayName}`}
          onPress={() =>
            router.push({
              pathname: '/connect/discover/profile-detail',
              params: { id: item.profile.id },
            })
          }
        >
          <Image source={{ uri: item.profile.photos[0] }} style={styles.photo} resizeMode="cover" />
          <View style={styles.reasonChip}>
            <Sparkles size={12} color={ConnectColors.brand} strokeWidth={2.2} />
            <Text style={styles.reasonText}>{item.reason}</Text>
          </View>
        </Pressable>
        <View style={styles.cardBody}>
          <Text style={styles.name}>
            {item.profile.displayName}, {item.profile.age}
          </Text>
          {item.profile.headline ? (
            <Text style={styles.headline} numberOfLines={1}>
              {item.profile.headline}
            </Text>
          ) : null}
          <DiscoveryVerifiedBadges flags={item.profile.verified} size="sm" />
          <View style={styles.actions}>
            <View style={styles.actionFlex}>
              <PrimaryButton
                label="View"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/connect/discover/profile-detail',
                    params: { id: item.profile.id },
                  })
                }
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Like ${item.profile.displayName}`}
              disabled={swipe.isPending}
              onPress={() => onLike(item)}
              style={({ pressed }) => [
                styles.likeBtn,
                pressed && { opacity: 0.8 },
                swipe.isPending && { opacity: 0.5 },
              ]}
            >
              <Heart size={24} color={Colors.onPrimary} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Daily picks" />

      {picksQuery.isLoading ? (
        <StateView kind="loading" message="Curating today's picks…" />
      ) : picksQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load picks"
          message="Please try again."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => picksQuery.refetch()}
        />
      ) : picks.length === 0 ? (
        <StateView
          kind="empty"
          title="No picks today"
          message="Check back tomorrow for a fresh set."
          icon="Sparkles"
        />
      ) : (
        <FlatList
          data={picks}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  photo: { width: '100%', height: 280, backgroundColor: Colors.surfaceContainerHigh },
  reasonChip: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  reasonText: { ...Typography.labelSm, color: ConnectColors.brand },
  cardBody: { padding: Spacing.md, gap: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: ConnectColors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  actionFlex: { flex: 1 },
  likeBtn: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: ConnectColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
