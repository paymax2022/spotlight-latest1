import { Text, View } from 'react-native';

import { votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

export function LiveBadge() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: votingColors.indigo.container,
        borderRadius: votingRadius.full,
        paddingHorizontal: votingSpacing.sm,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      {/* Pulse dot */}
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: votingRadius.full,
          backgroundColor: votingColors.onSurface,
        }}
      />
      <Text style={[votingTypography.labelSm, { color: votingColors.onSurface }]}>LIVE</Text>
    </View>
  );
}

export function TrendingBadge() {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: votingColors.gold.DEFAULT,
        borderRadius: votingRadius.full,
        paddingHorizontal: votingSpacing.sm,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>↑ TRENDING</Text>
    </View>
  );
}

interface RankBadgeProps {
  rank: number;
}

export function RankBadge({ rank }: RankBadgeProps) {
  const isTop3 = rank <= 3;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: votingRadius.full,
        borderWidth: 1,
        borderColor: isTop3 ? votingColors.gold.DEFAULT : votingColors.outline,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isTop3 ? 'rgba(242,202,80,0.12)' : 'transparent',
      }}
    >
      <Text
        style={[
          votingTypography.labelSm,
          { color: isTop3 ? votingColors.gold.DEFAULT : votingColors.onSurfaceMuted },
        ]}
      >
        #{rank}
      </Text>
    </View>
  );
}
