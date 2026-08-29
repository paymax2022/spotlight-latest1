import React from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Heart, X, Star, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useProfileDetail, useSwipe } from '@/features/connect/discovery/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import type { SwipeAction } from '@/features/connect/discovery/types';

/**
 * Full profile detail (PRD §10.2). SAFETY §4: the Pass/Like/Super actions still
 * only open chat through a mutual match (match-modal). Report routes to the
 * messaging-owned safety surface — discovery never owns reports.
 */
export default function ProfileDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const profileId = id ?? '';
  const { width } = useWindowDimensions();
  const detailQuery = useProfileDetail(profileId);
  const swipe = useSwipe();

  const profile = detailQuery.data;

  function onAction(action: SwipeAction) {
    if (!profile) return;
    swipe.mutate(
      { profileId: profile.id, action },
      {
        onSuccess: (result) => {
          if (result.matched) {
            router.push({
              pathname: '/connect/discovery/match-modal',
              params: {
                matchId: result.matchId ?? '',
                threadId: result.threadId ?? '',
                profileId: profile.id,
                name: profile.displayName,
              },
            });
          } else {
            goBack('/connect');
          }
        },
      },
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Profile" />

      {detailQuery.isLoading ? (
        <StateView kind="loading" message="Loading profile…" />
      ) : detailQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load profile"
          message="Please try again."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => detailQuery.refetch()}
        />
      ) : !profile ? (
        <StateView kind="empty" title="Profile not found" icon="UserX" />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.carousel}
            >
              {profile.photos.map((uri, i) => (
                <Image
                  key={`${uri}-${i}`}
                  source={{ uri }}
                  style={[styles.carouselPhoto, { width: width }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>

            <View style={styles.content}>
              <Text style={styles.name}>
                {profile.displayName}, {profile.age}
              </Text>
              {profile.headline ? <Text style={styles.headline}>{profile.headline}</Text> : null}
              <View style={styles.distanceRow}>
                <MapPin size={14} color={ConnectColors.muted} strokeWidth={2} />
                <Text style={styles.distance}>{profile.distanceLabel}</Text>
              </View>

              <DiscoveryVerifiedBadges flags={profile.verified} />

              {profile.bio ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>About</Text>
                  <Text style={styles.bio}>{profile.bio}</Text>
                </View>
              ) : null}

              {profile.interests.length ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Interests</Text>
                  <DiscoveryChipRow items={profile.interests} variant="static" />
                </View>
              ) : null}

              {profile.prompts.length ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Prompts</Text>
                  <View style={{ gap: Spacing.sm }}>
                    {profile.prompts.map((p, i) => (
                      <View key={`${p.prompt}-${i}`} style={styles.promptCard}>
                        <Text style={styles.promptLabel}>{p.prompt}</Text>
                        <Text style={styles.promptAnswer}>{p.answer}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/connect/settings/report')}
                style={styles.reportLink}
              >
                <Text style={styles.reportText}>Report this profile</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.actionBar}>
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
          </View>
        </>
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
  scroll: { paddingBottom: Spacing.xl },
  carousel: { backgroundColor: Colors.surfaceContainerHigh },
  carouselPhoto: { height: 460, backgroundColor: Colors.surfaceContainerHigh },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  headline: { ...Typography.bodyMd, color: ConnectColors.muted },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distance: { ...Typography.labelSm, color: ConnectColors.muted },
  section: { marginTop: Spacing.md, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bio: { ...Typography.bodyMd, color: Colors.onSurface },
  promptCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  promptLabel: { ...Typography.labelSm, color: ConnectColors.brand },
  promptAnswer: { ...Typography.bodyMd, color: Colors.onSurface },
  reportLink: { marginTop: Spacing.lg, alignSelf: 'center', paddingVertical: Spacing.sm },
  reportText: { ...Typography.labelMd, color: ConnectColors.muted, textDecorationLine: 'underline' },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.xl,
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
