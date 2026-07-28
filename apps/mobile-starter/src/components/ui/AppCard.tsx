import { ReactNode } from 'react';
import { View, ViewProps } from 'react-native';

import { colors, radius, shadows, spacing } from '@/theme';

export function AppCard({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: colors.neutral.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.neutral.border,
          padding: spacing[4],
          gap: spacing[3],
          ...shadows.card
        },
        style
      ]}
    >
      {children}
    </View>
  );
}
