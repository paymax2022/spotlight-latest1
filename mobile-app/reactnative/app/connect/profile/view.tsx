import React from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, Heart, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useUnifiedProfile } from '@/features/connect/profile/hooks';
import type { ConnectMode } from '@/features/connect/profile/types';
import type { VerificationFlag } from '@/features/connect/discovery/types';

// PR — Profile preview. Renders the selected mode's ModeProfile exactly as
// another person would see it in that surface. Never blends modes.
export default function ProfileView() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: ConnectMode = params.mode === 'network' ? 'network' : 'date';
  const { width } = useWindowDimensions();
  const { data, isLoading, error, refetch } = useUnifiedProfile();

  const profile = mode === 'date' ? data?.dateProfile : data?.networkProfile;
  const ModeIcon = mode === 'date' ? Heart : Briefcase;

  // Build the compact VerificationFlag[] from the account-level booleans.
  const flags: VerificationFlag[] = [];
  if (data?.verification.selfie) flags.push('selfie');
  if (data?.verification.identity) flags.push('identity');
  if (data?.verification.photo) flags.push('photo');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Preview"
        subtitle={mode === 'date' ? 'Date profile' : 'Network profile'}
        rightSlot={
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => router.push(`/connect/profile/edit?mode=${mode}`)}
          >
            <Pencil size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading preview…" />
      ) : error || !data || !profile ? (
        <StateView
          kind="error"
          title="Couldn't load preview"
          icon="UserX"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {/* Photos carousel */}
          {profile.photos.length > 0 ? (
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
                  style={[styles.photo, { width }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.photo, styles.photoEmpty, { width }]}>
              <Text style={styles.photoEmptyText}>No photos yet</Text>
            </View>
          )}

          <View style={styles.content}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>
                {data.displayName}
                <Text style={styles.age}>, {data.age}</Text>
              </Text>
              <View style={styles.modeBadge}>
                <ModeIcon size={13} color={ConnectColors.brand} strokeWidth={2.2} />
                <Text style={styles.modeBadgeText}>{mode === 'date' ? 'Date' : 'Network'}</Text>
              </View>
            </View>

            {profile.headline ? <Text style={styles.headline}>{profile.headline}</Text> : null}

            <View style={styles.intentPill}>
              <Text style={styles.intentText}>
                {mode === 'date' ? `Looking for ${profile.intent}` : profile.intent}
              </Text>
            </View>

            <View style={styles.badgesWrap}>
              <DiscoveryVerifiedBadges flags={flags} />
            </View>

            {profile.bio ? (
              <>
                <Text style={styles.sectionTitle}>About</Text>
                <Text style={styles.bio}>{profile.bio}</Text>
              </>
            ) : null}

            {profile.interests.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>
                  {mode === 'date' ? 'Interests' : 'Skills & interests'}
                </Text>
                <DiscoveryChipRow items={profile.interests} variant="static" />
              </>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingBottom: 60 },
  carousel: { backgroundColor: Colors.surfaceContainerHigh },
  photo: { height: 440 },
  photoEmpty: {
    height: 440,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmptyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.headlineMd, color: Colors.onSurface, flexShrink: 1 },
  age: { ...Typography.headlineMd, color: Colors.onSurfaceVariant },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgPurple,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  modeBadgeText: { ...Typography.labelSm, color: ConnectColors.brand, fontWeight: '700' },
  headline: { ...Typography.bodyLg, color: Colors.onSurface, marginTop: Spacing.xs },
  intentPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.iconBgBlue,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  intentText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
  badgesWrap: { marginTop: Spacing.md },
  sectionTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  bio: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
});
