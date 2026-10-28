import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Settings,
  ShieldCheck,
  Trophy,
  Wallet,
  ChevronRight,
  Flame,
  Star,
  Pencil,
  MapPin,
  Eye,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMeSummary } from '@/features/connect/hooks/useConnect';
import { useUnifiedProfile } from '@/features/connect/profile/hooks';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import TierLimitBar from '@/features/connect/components/TierLimitBar';

// ST-01 — Me / hub. Entry to profile, wallet/tier, gamification, settings.
export default function MeTab() {
  const { data, isLoading, error, refetch } = useMeSummary();
  const { data: profile } = useUnifiedProfile();
  // The saved profile is the source of truth; /me is only a fallback while it loads.
  const shownName = profile?.displayName || data?.displayName || '';
  const primaryPhoto = profile?.photoItems[0]?.url;
  const headline = profile?.dateProfile.headline || data?.headline || '';
  const missing = profile
    ? [
        profile.photoItems.length === 0 && 'a photo',
        !profile.dateProfile.bio && 'a bio',
        profile.dateProfile.interests.length === 0 && 'interests',
      ].filter(Boolean)
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Me"
        showBack={false}
        rightSlot={
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push('/connect/settings')}
          >
            <Settings size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your profile…" />
      ) : error || !data ? (
        <StateView
          kind="error"
          title="Couldn't load profile"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {/* Profile card */}
          <View style={styles.profileCard}>
            <Pressable
              style={styles.identity}
              accessibilityRole="button"
              accessibilityLabel="View my profile"
              onPress={() => router.push('/connect/profile/view?mode=date')}
            >
              {primaryPhoto ? (
                <Image source={{ uri: primaryPhoto }} style={styles.photoAvatar} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{shownName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.identityBody}>
                <Text style={styles.name}>
                  {shownName}
                  {profile && profile.age > 0 ? <Text style={styles.age}>, {profile.age}</Text> : null}
                </Text>
                {profile?.city ? (
                  <View style={styles.cityRow}>
                    <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.headline}>{profile.city}</Text>
                  </View>
                ) : null}
                {headline ? <Text style={styles.headline}>{headline}</Text> : null}
                <View style={styles.intentRow}>
                  {data.intents.map((it) => (
                    <View key={it} style={styles.intentChip}>
                      <Text style={styles.intentChipText}>{labelForIntent(it)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Pressable>

            {missing.length > 0 ? (
              <Text style={styles.completeHint}>Add {missing.join(', ')} to complete your profile.</Text>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionBtn, styles.actionPrimary]}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={() => router.push('/connect/profile/edit?mode=date')}
              >
                <Pencil size={16} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.actionPrimaryText}>Edit profile</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.actionSecondary]}
                accessibilityRole="button"
                accessibilityLabel="Preview profile"
                onPress={() => router.push('/connect/profile/view?mode=date')}
              >
                <Eye size={16} color={ConnectColors.brand} strokeWidth={2.2} />
                <Text style={styles.actionSecondaryText}>Preview</Text>
              </Pressable>
            </View>
          </View>

          {/* Wallet + tier (money surface → must show tier/limit/remaining) */}
          <Pressable style={styles.walletCard} onPress={() => router.push('/connect/settings')}>
            <View style={styles.walletHeader}>
              <View style={styles.walletIcon}>
                <Wallet size={18} color={Colors.onPrimary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletLabel}>Connect wallet</Text>
                <Text style={styles.walletBalance}>{formatKobo(data.wallet.balanceKobo)}</Text>
              </View>
            </View>
          </Pressable>
          <TierLimitBar tier={data.wallet.tier} />

          {/* Gamification entry */}
          <Pressable
            style={styles.gamiCard}
            onPress={() => router.push('/connect/me')}
            accessibilityRole="button"
            accessibilityLabel="Gamification"
          >
            <View style={styles.gamiHead}>
              <Trophy size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.gamiTitle}>Level {data.gamification.level}</Text>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} style={{ marginLeft: 'auto' }} />
            </View>
            <View style={styles.gamiStats}>
              <Stat icon={<Star size={16} color={Colors.secondary} />} value={`${data.gamification.points}`} label="points" />
              <Stat icon={<Flame size={16} color={Colors.error} />} value={`${data.gamification.streakDays}d`} label="streak" />
              <Stat icon={<ShieldCheck size={16} color={Colors.teal} />} value={`${data.gamification.badges}`} label="badges" />
            </View>
          </Pressable>

          <Pressable
            style={styles.settingsRow}
            onPress={() => router.push('/connect/settings')}
            accessibilityRole="button"
          >
            <Settings size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.settingsText}>Settings, safety & support</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} style={{ marginLeft: 'auto' }} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function labelForIntent(i: string): string {
  return i === 'date' ? 'Dating' : i === 'network' ? 'Networking' : 'Discover';
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f5f7' },
  body: { paddingHorizontal: 0, paddingBottom: Spacing.lg, gap: Spacing.sm },

  // HERO PROFILE CARD - Large, modern Tinder-style swiping card aesthetic
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginTop: 0,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    gap: Spacing.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },

  identity: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: '#FF4458',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },

  photoAvatar: {
    width: 120,
    height: 160,
    borderRadius: 12,
    backgroundColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.sm,
    resizeMode: 'cover',
  },

  avatar: {
    width: 120,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarText: {
    ...Typography.displayMd,
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
  },

  identityBody: {
    flex: 1,
    gap: Spacing.sm,
    width: '100%',
  },

  name: {
    ...Typography.headlineLg,
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },

  age: {
    ...Typography.titleMd,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },

  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },

  headline: {
    ...Typography.bodyMd,
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 20,
    marginBottom: Spacing.xs,
  },

  intentRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    flexWrap: 'wrap',
  },

  intentChip: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },

  intentChipText: {
    ...Typography.labelMd,
    color: '#fff',
    fontWeight: '600',
  },

  completeHint: {
    ...Typography.labelMd,
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },

  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },

  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },

  actionPrimary: {
    backgroundColor: '#FF4458',
  },

  actionPrimaryText: {
    ...Typography.labelLg,
    color: '#fff',
    fontWeight: '700',
  },

  actionSecondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#FFB81C',
  },

  actionSecondaryText: {
    ...Typography.labelLg,
    color: '#FFB81C',
    fontWeight: '700',
  },

  // WALLET CARD - Modern gradient Bumble style
  walletCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  walletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },

  walletIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFB81C',
    alignItems: 'center',
    justifyContent: 'center',
  },

  walletLabel: {
    ...Typography.labelMd,
    color: '#666',
    fontWeight: '600',
  },

  walletBalance: {
    ...Typography.headlineLg,
    color: '#000',
    fontWeight: '700',
    fontSize: 24,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: Spacing.lg,
    gap: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  cardTitle: {
    ...Typography.labelMd,
    color: '#999',
    marginBottom: Spacing.sm,
    fontWeight: '600',
  },

  // GAMIFICATION CARD - Badoo-style with bold graphics
  gamiCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  gamiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },

  gamiTitle: {
    ...Typography.headlineMd,
    color: '#000',
    fontWeight: '700',
    fontSize: 20,
  },

  gamiStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },

  stat: {
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
    backgroundColor: '#f5f5f7',
    paddingVertical: Spacing.lg,
    borderRadius: 12,
  },

  statValue: {
    ...Typography.headlineMd,
    color: '#000',
    fontWeight: '700',
    fontSize: 22,
  },

  statLabel: {
    ...Typography.labelMd,
    color: '#999',
    fontWeight: '600',
  },

  // SETTINGS ROW
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  settingsText: {
    ...Typography.labelLg,
    color: '#000',
    fontWeight: '600',
  },
});
