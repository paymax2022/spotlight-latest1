import { Image, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  CARD_OVERLAY_GRADIENT,
  GLASS_BORDER,
  votingColors,
  votingRadius,
  votingSpacing,
  votingTypography,
} from '@/theme/voting';
import { LiveBadge, TrendingBadge } from './Badges';

export interface Contest {
  id: string;
  title: string;
  category: string;
  coverUrl?: string;
  contestantCount: number;
  totalVotes: number;
  endsAt: string;
  isLive: boolean;
  isTrending?: boolean;
}

interface Props {
  contest: Contest;
  onPress?: () => void;
}

export function ContestCard({ contest, onPress }: Props) {
  const timeLeft = getTimeLeft(contest.endsAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: votingRadius.xl,
        overflow: 'hidden',
        height: 200,
        opacity: pressed ? 0.88 : 1,
        borderWidth: 1,
        borderColor: GLASS_BORDER,
      })}
    >
      {contest.coverUrl ? (
        <Image
          source={{ uri: contest.coverUrl }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[votingColors.bg.elevated, votingColors.bg.card]}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      )}

      <LinearGradient
        colors={CARD_OVERLAY_GRADIENT}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75%' }}
      />

      {/* Top badges */}
      <View
        style={{
          position: 'absolute',
          top: votingSpacing.md,
          left: votingSpacing.md,
          right: votingSpacing.md,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {contest.isLive && <LiveBadge />}
          {contest.isTrending && <TrendingBadge />}
        </View>
        <View
          style={{
            backgroundColor: votingColors.bg.glassStrong,
            borderRadius: votingRadius.full,
            paddingHorizontal: votingSpacing.sm,
            paddingVertical: 4,
            borderWidth: 1,
            borderColor: GLASS_BORDER,
          }}
        >
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurface }]}>{timeLeft}</Text>
        </View>
      </View>

      {/* Bottom info */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: votingSpacing.md,
          gap: 6,
        }}
      >
        <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>
          {contest.category.toUpperCase()}
        </Text>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface }]} numberOfLines={2}>
          {contest.title}
        </Text>
        <View style={{ flexDirection: 'row', gap: votingSpacing.md }}>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
            {contest.contestantCount} contestants
          </Text>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
            {contest.totalVotes.toLocaleString()} votes cast
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function getTimeLeft(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 48) return `${Math.floor(h / 24)}d left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
