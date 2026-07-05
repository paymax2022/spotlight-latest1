import React, { useState } from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lock, Crown, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useLikesYou } from '@/features/connect/discovery/hooks';
import type { LikesYouEntry } from '@/features/connect/discovery/types';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Likes-you (PRD §10.2 DC-05). Premium-gated: when locked the server returns a
 * count + blurred previews only (no identity leak). `premium` is local-only here
 * to simulate the unlock.
 */
export default function LikesYouScreen() {
  const [premium, setPremium] = useState(false);
  const likesQuery = useLikesYou(premium);
  const data = likesQuery.data;

  function renderItem({ item }: { item: LikesYouEntry }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${item.profile.displayName}`}
        onPress={() =>
          router.push({
            pathname: '/connect/discover/profile-detail',
            params: { id: item.profile.id },
          })
        }
        style={styles.card}
      >
        <Image source={{ uri: item.profile.photos[0] }} style={styles.cardPhoto} resizeMode="cover" />
        {item.isSuper ? (
          <View style={styles.superBadge}>
            <Star size={12} color={Colors.onPrimary} strokeWidth={2.4} fill={Colors.secondary} />
          </View>
        ) : null}
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.profile.displayName}, {item.profile.age}
          </Text>
          <Text style={styles.cardMeta}>{relativeTime(item.likedAt)}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Likes you" />

      {likesQuery.isLoading ? (
        <StateView kind="loading" message="Loading your admirers…" />
      ) : likesQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load likes"
          message="Please try again."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => likesQuery.refetch()}
        />
      ) : data?.locked ? (
        <View style={styles.gate}>
          <View style={styles.gateIcon}>
            <Lock size={32} color={ConnectColors.brand} strokeWidth={2} />
          </View>
          <Text style={styles.gateCount}>
            {data.count} {data.count === 1 ? 'person likes' : 'people like'} you
          </Text>
          <Text style={styles.gateCopy}>
            See everyone who liked you and match instantly with Connect Plus.
          </Text>
          <View style={styles.gateBtn}>
            <PrimaryButton
              label="Unlock with Connect Plus"
              onPress={() => setPremium(true)}
            />
          </View>
        </View>
      ) : !data || data.entries.length === 0 ? (
        <StateView
          kind="empty"
          title="No likes yet"
          message="Keep swiping — your likes will show up here."
          icon="Heart"
        />
      ) : (
        <FlatList
          data={data.entries}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.unlockedHeader}>
              <Crown size={16} color={Colors.gold} strokeWidth={2.2} />
              <Text style={styles.unlockedText}>
                {data.count} {data.count === 1 ? 'person likes' : 'people like'} you
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  gateIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  gateCount: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  gateCopy: { ...Typography.bodyMd, color: ConnectColors.muted, textAlign: 'center' },
  gateBtn: { width: '100%', marginTop: Spacing.sm },
  listContent: { padding: Spacing.containerMargin, gap: Spacing.md },
  column: { gap: Spacing.md },
  unlockedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  unlockedText: { ...Typography.labelMd, color: Colors.onSurface },
  card: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  cardPhoto: { width: '100%', height: 180, backgroundColor: Colors.surfaceContainerHigh },
  superBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: Spacing.sm, gap: 2 },
  cardName: { ...Typography.labelMd, color: Colors.onSurface },
  cardMeta: { ...Typography.labelSm, color: ConnectColors.muted },
});
