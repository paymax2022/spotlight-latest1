import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Camera,
  Pencil,
  Eye,
  EyeOff,
  ShieldCheck,
  MapPin,
  Plus,
  ChevronRight,
  Trophy,
  Coins,
  Flame,
  Zap,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useUnifiedProfile } from '@/features/connect/profile/hooks';
import { useWalletSummary } from '@/features/connect/wallet/hooks';
import { useGamificationProfile } from '@/features/connect/gamification/hooks';
import type { VerificationFlag } from '@/features/connect/discovery/types';

const EDIT_PROFILE = '/connect/profile/edit?mode=date';
const PHOTOS = '/connect/profile/photos';

// ST-01 detail — My profile. The card renders the member's own Connect profile the
// way the preview does, and every empty field is a prompt that opens the editor for
// that field rather than disappearing with the section. Wallet/tier and rewards sit
// below it on the same scroll.
export default function MeProfile() {
  const { data: profile, isLoading, isError, refetch } = useUnifiedProfile();
  const wallet = useWalletSummary();
  const game = useGamificationProfile();
  const [bioExpanded, setBioExpanded] = useState(false);

  const date = profile?.dateProfile;
  const photos = profile?.photoItems ?? [];
  const hero = photos[0]?.url;
  const bio = date?.bio ?? '';
  const interests = date?.interests ?? [];

  // Selfie comes from the profile's own badge; ID from the wallet's tier, which is
  // only reachable by linking a BVN or NIN. So the row claims nothing the server
  // has not already verified, and needs no second request.
  const flags: VerificationFlag[] = [];
  if (profile?.verification.selfie) flags.push('selfie');
  const tier = wallet.data?.tier;
  if (tier && tier.tier >= 1) flags.push('identity');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My profile" backFallback="/connect" />

      {isLoading ? (
        <StateView kind="loading" message="Loading your profile…" />
      ) : isError || !profile ? (
        <StateView
          kind="error"
          title="Couldn't load profile"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {hero ? (
            <Image
              source={{ uri: hero }}
              style={styles.hero}
              resizeMode="cover"
              accessibilityLabel="Your primary photo"
            />
          ) : (
            <Pressable
              onPress={() => router.push(PHOTOS)}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              style={styles.heroEmpty}
            >
              <Camera size={30} color={ConnectColors.muted} strokeWidth={1.8} />
              <Text style={styles.heroEmptyText}>Add a photo</Text>
              <Text style={styles.heroEmptyHint}>Your first photo is what people see first</Text>
            </Pressable>
          )}

          <View style={styles.sheet}>
            <View style={styles.actionRow}>
              <CircleAction
                icon={<Camera size={22} color={Colors.onSurface} strokeWidth={2.2} />}
                label="Edit photos"
                onPress={() => router.push(PHOTOS)}
              />
              <CircleAction
                icon={<Pencil size={22} color={Colors.onPrimary} strokeWidth={2.2} />}
                label="Edit profile"
                primary
                onPress={() => router.push(EDIT_PROFILE)}
              />
              <CircleAction
                icon={<Eye size={22} color={Colors.onSurface} strokeWidth={2.2} />}
                label="Preview as others see it"
                onPress={() => router.push('/connect/profile/view?mode=date')}
              />
            </View>

            <View style={styles.nameRow}>
              {profile.displayName ? (
                <Text style={styles.name} numberOfLines={1}>
                  {profile.displayName}
                  {profile.age > 0 ? <Text style={styles.age}>, {profile.age}</Text> : null}
                </Text>
              ) : (
                <Pressable
                  onPress={() => router.push(EDIT_PROFILE)}
                  accessibilityRole="button"
                  accessibilityLabel="Add your name"
                >
                  <Text style={[styles.name, styles.nameEmpty]}>Add your name</Text>
                </Pressable>
              )}
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Verification badges"
                onPress={() => router.push('/connect/profile/badges')}
                style={styles.verifyBtn}
              >
                <ShieldCheck size={18} color={ConnectColors.brand} strokeWidth={2.2} />
              </Pressable>
            </View>

            <View style={styles.badgesWrap}>
              <DiscoveryVerifiedBadges flags={flags} size="sm" />
            </View>

            {date?.headline ? (
              <Text style={styles.headline}>{date.headline}</Text>
            ) : (
              <FillIn label="Add a headline" onPress={() => router.push(EDIT_PROFILE)} />
            )}

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>Location</Text>
                <View style={[styles.visibilityChip, !date?.visible && styles.visibilityChipOff]}>
                  {date?.visible ? (
                    <Eye size={12} color={ConnectColors.ok} strokeWidth={2.4} />
                  ) : (
                    <EyeOff size={12} color={Colors.onSurfaceVariant} strokeWidth={2.4} />
                  )}
                  <Text
                    style={[
                      styles.visibilityText,
                      !date?.visible && styles.visibilityTextOff,
                    ]}
                  >
                    {date?.visible ? 'Visible in Dating' : 'Hidden from Dating'}
                  </Text>
                </View>
              </View>
              {profile.city ? (
                <View style={styles.cityRow}>
                  <MapPin size={15} color={ConnectColors.muted} strokeWidth={2} />
                  <Text style={styles.city}>{profile.city}</Text>
                </View>
              ) : (
                <FillIn label="Set your city" onPress={() => router.push(EDIT_PROFILE)} />
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>About</Text>
              {bio ? (
                <>
                  <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : 3}>
                    {bio}
                  </Text>
                  {bio.length > 180 || bio.includes('\n') ? (
                    <Pressable
                      onPress={() => setBioExpanded((v) => !v)}
                      accessibilityRole="button"
                      style={styles.readMore}
                    >
                      <Text style={styles.readMoreText}>{bioExpanded ? 'Show less' : 'Read more'}</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <FillIn label="Write your bio" onPress={() => router.push(EDIT_PROFILE)} />
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Interests</Text>
              {interests.length ? (
                <DiscoveryChipRow items={interests} variant="static" />
              ) : (
                <FillIn label="Add interests" onPress={() => router.push(EDIT_PROFILE)} />
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>Gallery</Text>
                {photos.length > 1 ? (
                  <Pressable
                    onPress={() => router.push(PHOTOS)}
                    accessibilityRole="button"
                    accessibilityLabel="See all photos"
                    style={styles.seeAll}
                    hitSlop={8}
                  >
                    <Text style={styles.seeAllText}>See all</Text>
                    <ChevronRight size={14} color={ConnectColors.brand} strokeWidth={2.4} />
                  </Pressable>
                ) : null}
              </View>
              {photos.length ? (
                <View style={styles.gallery}>
                  <View style={styles.galleryRow}>
                    {photos.slice(0, 2).map((ph) => (
                      <Image
                        key={ph.id}
                        source={{ uri: ph.url }}
                        style={styles.galleryLarge}
                        resizeMode="cover"
                      />
                    ))}
                  </View>
                  {photos.length > 2 ? (
                    <View style={styles.galleryRow}>
                      {photos.slice(2, 5).map((ph) => (
                        <Image
                          key={ph.id}
                          source={{ uri: ph.url }}
                          style={styles.gallerySmall}
                          resizeMode="cover"
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <FillIn label="Add a photo" onPress={() => router.push(PHOTOS)} />
              )}
            </View>
          </View>

          <View style={styles.below}>
            <Text style={styles.outsideLabel}>Wallet & tier</Text>
            {wallet.isLoading ? (
              <Text style={styles.mutedLine}>Loading your wallet…</Text>
            ) : wallet.isError || !wallet.data ? (
              <RetryLine
                message="Couldn't load your wallet balance."
                onRetry={() => wallet.refetch()}
              />
            ) : (
              <>
                <View style={styles.balanceCard}>
                  <Text style={styles.balanceLabel}>Balance</Text>
                  <Text style={styles.balanceValue}>{formatKobo(wallet.data.balanceKobo)}</Text>
                  <Pressable
                    onPress={() => router.push('/connect/wallet/home')}
                    accessibilityRole="button"
                    accessibilityLabel="Open wallet"
                    style={styles.balanceOpen}
                  >
                    <Text style={styles.balanceOpenText}>Open wallet</Text>
                    <ChevronRight size={16} color={Colors.onPrimary} strokeWidth={2.4} />
                  </Pressable>
                </View>
                <TierLimitBar tier={wallet.data.tier} />
              </>
            )}

            <Text style={styles.outsideLabel}>Rewards & progress</Text>
            {game.isLoading ? (
              <Text style={styles.mutedLine}>Loading your progress…</Text>
            ) : game.isError || !game.data ? (
              <RetryLine
                message="Couldn't load your XP and coins."
                onRetry={() => game.refetch()}
              />
            ) : (
              <View style={styles.card}>
                <View style={styles.levelRow}>
                  <View style={styles.levelBadge}>
                    <Trophy size={15} color={Colors.gold} strokeWidth={2.2} />
                    <Text style={styles.levelText}>Level {game.data.level}</Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/connect/gamification/home')}
                    accessibilityRole="button"
                    accessibilityLabel="Open rewards"
                    style={styles.seeAll}
                    hitSlop={8}
                  >
                    <Text style={styles.seeAllText}>See missions</Text>
                    <ChevronRight size={14} color={ConnectColors.brand} strokeWidth={2.4} />
                  </Pressable>
                </View>

                <View style={styles.xpTrack}>
                  <View
                    style={[
                      styles.xpFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.round((game.data.xp / game.data.xpToNextLevel) * 100),
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.xpText}>
                  {game.data.xp.toLocaleString('en-NG')} / {game.data.xpToNextLevel.toLocaleString('en-NG')} XP to
                  level {game.data.level + 1}
                </Text>

                <View style={styles.statsRow}>
                  <Stat
                    icon={<Coins size={16} color={Colors.gold} strokeWidth={2.2} />}
                    value={game.data.coins.toLocaleString('en-NG')}
                    label="coins"
                  />
                  <Stat
                    icon={<Flame size={16} color={Colors.error} strokeWidth={2.2} />}
                    value={`${game.data.streakDays}d`}
                    label="streak"
                  />
                  <Stat
                    icon={<Zap size={16} color={Colors.secondary} strokeWidth={2.2} />}
                    value={game.data.totalXp.toLocaleString('en-NG')}
                    label="total XP"
                  />
                </View>

                <GameNonCashNotice compact />
              </View>
            )}

            <PrimaryButton
              label="Settings & safety"
              variant="secondary"
              onPress={() => router.push('/connect/settings')}
              style={styles.settingsBtn}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** The three circles that sit on the seam between the hero photo and the sheet. */
function CircleAction({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.circle,
        primary && styles.circlePrimary,
        pressed && styles.circlePressed,
      ]}
    >
      {icon}
    </Pressable>
  );
}

/** A missing field, presented as the tap target that fills it. */
function FillIn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fillIn, pressed && styles.fillInPressed]}
    >
      <Plus size={15} color={ConnectColors.brand} strokeWidth={2.6} />
      <Text style={styles.fillInText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.retryMessage}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button">
        <Text style={styles.retryAction}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 60 },

  hero: { width: '100%', height: 420, backgroundColor: Colors.surfaceContainerHigh },
  heroEmpty: {
    height: 300,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
  },
  heroEmptyText: { ...Typography.titleMd, color: Colors.onSurface },
  heroEmptyHint: { ...Typography.caption, color: Colors.onSurfaceVariant },

  // Overlaps the hero so the action circles can straddle its top edge.
  sheet: {
    marginTop: -28,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xl,
    marginTop: -32,
    marginBottom: Spacing.md,
  },
  circle: {
    width: 60,
    height: 60,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...shadow1,
  },
  circlePrimary: {
    width: 66,
    height: 66,
    backgroundColor: ConnectColors.brand,
    borderColor: ConnectColors.brand,
    ...shadow2,
  },
  circlePressed: { opacity: 0.85 },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  name: { ...Typography.headlineMd, color: Colors.onSurface, flexShrink: 1 },
  nameEmpty: { color: Colors.onSurfaceVariant, ...Typography.titleLg },
  age: { ...Typography.headlineMd, color: Colors.onSurfaceVariant },
  verifyBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  badgesWrap: { marginTop: Spacing.sm },
  headline: { ...Typography.bodyLg, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },

  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  sectionLabel: { ...Typography.titleMd, color: Colors.onSurface },
  visibilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgTeal,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  visibilityChipOff: { backgroundColor: Colors.surfaceContainerHigh },
  visibilityText: { ...Typography.caption, color: ConnectColors.ok, fontWeight: '700' },
  visibilityTextOff: { color: Colors.onSurfaceVariant },

  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  city: { ...Typography.bodyMd, color: Colors.onSurface },
  bio: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  readMore: { alignSelf: 'flex-start' },
  readMoreText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },

  fillIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: ConnectColors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
  },
  fillInPressed: { opacity: 0.8 },
  fillInText: { ...Typography.labelMd, color: ConnectColors.brand },

  gallery: { gap: Spacing.sm },
  galleryRow: { flexDirection: 'row', gap: Spacing.sm },
  galleryLarge: { flex: 1, height: 130, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  gallerySmall: { flex: 1, height: 92, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },

  below: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, gap: Spacing.md },
  outsideLabel: { ...Typography.titleMd, color: Colors.onSurface },
  mutedLine: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  balanceCard: {
    backgroundColor: ConnectColors.brand,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 2,
  },
  balanceLabel: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  balanceValue: { ...Typography.headlineMd, color: Colors.onPrimary },
  balanceOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: Spacing.xs,
    alignSelf: 'flex-start',
  },
  balanceOpenText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' },

  card: {
    backgroundColor: ConnectColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgGold,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  levelText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  xpTrack: {
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  xpFill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  xpText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },

  retryMessage: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  retryAction: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
  settingsBtn: { marginTop: Spacing.sm },
});
