import { ActivityIndicator, Pressable, PressableProps, Text, ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

type Props = PressableProps & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function AppButton({ title, loading, disabled, variant = 'primary', style, ...props }: Props) {
  const backgroundColor =
    variant === 'primary'
      ? colors.primary.navy
      : variant === 'secondary'
        ? colors.secondary.emerald
        : variant === 'danger'
          ? colors.secondary.red
          : 'transparent';
  const textColor = variant === 'ghost' ? colors.primary.blue : colors.neutral.white;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={[
        {
          minHeight: 52,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing[4],
          backgroundColor,
          opacity: disabled || loading ? 0.65 : 1,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.neutral.border
        },
        style as ViewStyle
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[typography.bodyMedium, { color: textColor }]}>{title}</Text>}
    </Pressable>
  );
}
