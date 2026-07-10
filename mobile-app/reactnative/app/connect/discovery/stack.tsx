import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  SlidersHorizontal,
  Heart,
  X,
  Star,
  RotateCcw,
  Zap,
  Sparkles,
  MapPin,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useDiscoveryStack, useSwipe } from '@/features/connect/discovery/hooks';
import { ProfileRequiredError } from '@/features/connect/discovery/api';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import type {
  DiscoveryFilters,
  DiscoveryMode,
  SwipeAction,
} from '@/features/connect/discovery/types';

const MODE_OPTIONS: { value: DiscoveryMode; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'network', label: 'Network' },
  { value: 'discover', label: 'Discover' },
];

const DEFAULT_FILTERS: DiscoveryFilters = {
  mode: 'date',
  minAge: 18,
  maxAge: 60,
  maxDistanceKm: 50,
  verifiedOnly: false,
  interests: [],
};

/**
 * Discovery card stack (PRD §10.2 DC-01). Date-mode swipe surface.
 * SAFETY §4: a swipe never opens a thread — only a mutual match (result.matched)
 * unlocks the match modal → messaging.
 */
export default function DiscoveryStackScreen() {
  const [mode, setMode] = useState<DiscoveryMode>('date');
  const [filters] = useState<DiscoveryFilters>(DEFAULT_FILTERS);
  const [index, setIndex] = useState(0);

  const stackQuery = useDiscoveryStack(filters);
  const swipe = useSwipe();

  const profiles = stackQuery.data ?? [];
  const current = profiles[index];

  const headerRight = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Likes you"
          onPress={() => router.push('/connect/discovery/likes-you')}
        >
          <Heart size={22} color={ConnectColors.brand} strokeWidth={2} />
        </Pressable>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => router.push('/connect/discovery/filters')}
        >
          <SlidersHorizontal size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>
    ),
    [],
  );

  function advance() {
    setIndex((i) => i + 1);
  }

  function onAction(action: SwipeAction) {
    if (!current) return;
    const profileId = current.id;
    const name = current.displayName;
    swipe.mutate(
      { profileId, action },
      {
        onSuccess: (result) => {
          if (result.matched) {
            router.push({
              pathname: '/connect/discovery/match-modal',
              params: {
                matchId: result.matchId ?? '',
                threadId: result.threadId ?? '',
                profileId,
                name,
              },
            });
          }
          advance();
        },
        onError: () => {
          // fail-soft: advance so the deck never wedges; backend owns the truth.
          advance();
        },
      },
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Discover" showBack={false} rightSlot={headerRight} />

      <View style={styles.modeWrap}>
        <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </View>

      {stackQuery.isLoading ? (
        <StateView kind="loading" message="Finding people near you…" />
      ) : stackQuery.error instanceof ProfileRequiredError ? (
        <StateView
          kind="empty"
          title="Set up your Connect profile"
          message="Create your profile to start discovering people. It only takes a minute."
          icon="Sparkles"
          actionLabel="Get started"
          onAction={() => router.push('/connect/onboarding/welcome')}
        />
      ) : stackQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load profiles"
          message="Something went wrong while finding people."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => stackQuery.refetch()}
        />
      ) : !current ? (
        <StateView
          kind="empty"
          title="You're all caught up"
          message="No more profiles right now. Check your daily picks or widen your filters."
          icon="Sparkles"
          actionLabel="View daily picks"
          onAction={() => router.push('/connect/discovery/daily-picks')}
        />
      ) : (
        <View style={styles.body}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${current.displayName}'s profile`}
              onPress={() =>
                router.push({
                  pathname: '/connect/discovery/profile-detail',
                  params: { id: current.id },
                })
              }
              style={styles.card}
            >
              {current.photos?.[0] ? (
                <Image source={{ uri: current.photos[0] }} style={styles.photo} resizeMode="cover" />
              ) : (
                <View style={styles.photo} />
              )}
              <View style={styles.cardBody}>
                <Text style={styles.name}>
                  {current.displayName}
                  {current.age ? `, ${current.age}` : ''}
                </Text>
                {current.headline ? <Text style={styles.headline}>{current.headline}</Text> : null}
                {current.distanceLabel ? (
                  <View style={styles.distanceRow}>
                    <MapPin size={14} color={ConnectColors.muted} strokeWidth={2} />
                    <Text style={styles.distance}>{current.distanceLabel}</Text>
                  </View>
                ) : null}
                <DiscoveryVerifiedBadges flags={current.verified ?? []} size="sm" />
                {current.prompts?.[0] ? (
                  <View style={styles.promptCard}>
                    <Text style={styles.promptLabel}>{current.prompts[0].prompt}</Text>
                    <Text style={styles.promptAnswer}>{current.prompts[0].answer}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/connect/discovery/daily-picks')}
              style={styles.dailyPicksBtn}
            >
              <Sparkles size={16} color={ConnectColors.brand} strokeWidth={2} />
              <Text style={styles.dailyPicksText}>See today's daily picks</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.actionBar}>
            <ActionButton
              label="Rewind"
              onPress={() => router.push('/connect/discovery/rewind')}
              icon={<RotateCcw size={22} color={Colors.gold} strokeWidth={2.2} />}
              size="sm"
            />
            <ActionButton
              label="Pass"
              onPress={() => onAction('pass')}
              icon={<X size={26} color={Colors.error} strokeWidth={2.4} />}
              disabled={swipe.isPending}
            />
            <ActionButton
              label="Super like"
              onPress={() => onAction('super')}
              icon={<Star size={22} color={Colors.secondary} strokeWidth={2.2} />}
              size="sm"
              disabled={swipe.isPending}
            />
            <ActionButton
              label="Like"
              onPress={() => onAction('like')}
              icon={<Heart size={26} color={ConnectColors.brand} strokeWidth={2.4} />}
              disabled={swipe.isPending}
            />
            <ActionButton
              label="Boost"
              onPress={() => router.push('/connect/discovery/boost')}
              icon={<Zap size={22} color={Colors.gold} strokeWidth={2.2} />}
              size="sm"
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  icon,
  size = 'md',
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon: React.ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.circle,
        size === 'sm' && styles.circleSm,
        pressed && styles.circlePressed,
        disabled && styles.circleDisabled,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  modeWrap: { paddingBottom: Spacing.sm },
  body: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  photo: { width: '100%', height: 420, backgroundColor: Colors.surfaceContainerHigh },
  cardBody: { padding: Spacing.md, gap: Spacing.sm },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  headline: { ...Typography.bodyMd, color: ConnectColors.muted },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distance: { ...Typography.labelSm, color: ConnectColors.muted },
  promptCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    marginTop: Spacing.xs,
  },
  promptLabel: { ...Typography.labelSm, color: ConnectColors.brand },
  promptAnswer: { ...Typography.bodyMd, color: Colors.onSurface },
  dailyPicksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.iconBgPurple,
  },
  dailyPicksText: { ...Typography.labelMd, color: ConnectColors.brand },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  circle: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...({ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 }),
  },
  circleSm: { width: 48, height: 48 },
  circlePressed: { opacity: 0.8 },
  circleDisabled: { opacity: 0.5 },
});
