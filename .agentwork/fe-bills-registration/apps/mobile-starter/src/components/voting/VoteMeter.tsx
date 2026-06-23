import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { VOTE_METER_GRADIENT, votingColors, votingRadius, votingTypography } from '@/theme/voting';

interface Props {
  percent: number;   // 0–100
  votes: number;
  label?: string;
}

export function VoteMeter({ percent, votes, label }: Props) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <View style={{ gap: 6 }}>
      {label && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>{label}</Text>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurface }]}>
            {votes.toLocaleString()} votes
          </Text>
        </View>
      )}
      <View
        style={{
          height: 6,
          borderRadius: votingRadius.full,
          backgroundColor: votingColors.bg.high,
          overflow: 'hidden',
        }}
      >
        <LinearGradient
          colors={VOTE_METER_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            height: '100%',
            width: `${clamped}%`,
            borderRadius: votingRadius.full,
            // Leading-edge glow
            shadowColor: '#6366f1',
            shadowOffset: { width: 2, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 6,
          }}
        />
      </View>
      {!label && (
        <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'right' }]}>
          {clamped.toFixed(1)}%
        </Text>
      )}
    </View>
  );
}
