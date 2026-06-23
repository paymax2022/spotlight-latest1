import { Image, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  CARD_OVERLAY_GRADIENT,
  GOLD_GLOW_SHADOW,
  GLASS_BORDER,
  votingColors,
  votingRadius,
  votingSpacing,
  votingTypography,
} from '@/theme/voting';
import { RankBadge } from './Badges';
import { VoteMeter } from './VoteMeter';

export interface Contestant {
  id: string;
  name: string;
  category?: string;
  photoUrl?: string;
  rank: number;
  voteCount: number;
  votePercent: number;
  isTopContestant?: boolean;
}

interface Props {
  contestant: Contestant;
  onPress?: () => void;
  onVote?: () => void;
  compact?: boolean;
}

export function ContestantCard({ contestant, onPress, onVote, compact = false }: Props) {
  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: votingSpacing.md,
          backgroundColor: votingColors.bg.card,
          borderRadius: votingRadius.lg,
          borderWidth: 1,
          borderColor: GLASS_BORDER,
          padding: votingSpacing.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {/* Rank */}
        <RankBadge rank={contestant.rank} />

        {/* Avatar */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: votingRadius.full,
            overflow: 'hidden',
            backgroundColor: votingColors.bg.elevated,
          }}
        >
          {contestant.photoUrl ? (
            <Image source={{ uri: contestant.photoUrl }} style={{ width: 48, height: 48 }} />
          ) : (
            <View
              style={{
                width: 48,
                height: 48,
                backgroundColor: votingColors.bg.high,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[votingTypography.headlineSm, { color: votingColors.gold.DEFAULT }]}>
                {contestant.name.charAt(0)}
              </Text>
            </View>
          )}
        </View>

        {/* Info + meter */}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface }]} numberOfLines={1}>
            {contestant.name}
          </Text>
          {contestant.category && (
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
              {contestant.category}
            </Text>
          )}
          <VoteMeter percent={contestant.votePercent} votes={contestant.voteCount} />
        </View>

        {/* Vote count */}
        <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>
          {contestant.voteCount >= 1000
            ? `${(contestant.voteCount / 1000).toFixed(1)}K`
            : contestant.voteCount.toString()}
        </Text>
      </Pressable>
    );
  }

  // Full hero card — image background with gradient overlay
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: votingRadius.xl,
        overflow: 'hidden',
        height: 220,
        opacity: pressed ? 0.9 : 1,
        ...(contestant.isTopContestant ? GOLD_GLOW_SHADOW : {}),
      })}
    >
      {/* Background image or placeholder */}
      {contestant.photoUrl ? (
        <Image
          source={{ uri: contestant.photoUrl }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backgroundColor: votingColors.bg.elevated,
          }}
        />
      )}

      {/* Dark gradient overlay */}
      <LinearGradient
        colors={CARD_OVERLAY_GRADIENT}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' }}
      />

      {/* Rank badge top-left */}
      <View style={{ position: 'absolute', top: votingSpacing.md, left: votingSpacing.md }}>
        <RankBadge rank={contestant.rank} />
      </View>

      {/* Content at bottom */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: votingSpacing.md,
          gap: 8,
        }}
      >
        <Text style={[votingTypography.headlineMd, { color: votingColors.onSurface }]} numberOfLines={1}>
          {contestant.name}
        </Text>
        {contestant.category && (
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
            {contestant.category}
          </Text>
        )}
        <VoteMeter percent={contestant.votePercent} votes={contestant.voteCount} />
      </View>
    </Pressable>
  );
}
