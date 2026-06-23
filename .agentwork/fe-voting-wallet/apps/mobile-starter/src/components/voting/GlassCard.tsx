import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { GLASS_BORDER, GOLD_GLOW_SHADOW, votingColors, votingRadius, votingSpacing } from '@/theme/voting';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: boolean;
  padding?: number;
}

export function GlassCard({ children, style, glow = false, padding = votingSpacing.md }: Props) {
  return (
    <View
      style={[
        {
          backgroundColor: votingColors.bg.card,
          borderRadius: votingRadius.xl,
          borderWidth: 1,
          borderColor: GLASS_BORDER,
          padding,
          ...(glow ? GOLD_GLOW_SHADOW : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
