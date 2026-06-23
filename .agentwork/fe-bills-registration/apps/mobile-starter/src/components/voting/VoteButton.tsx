import { ActivityIndicator, Pressable, PressableProps, Text } from 'react-native';

import { votingColors, votingRadius, votingTypography } from '@/theme/voting';

type Variant = 'gold' | 'outline' | 'ghost';

interface Props extends PressableProps {
  title: string;
  loading?: boolean;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export function VoteButton({
  title,
  loading,
  disabled,
  variant = 'gold',
  size = 'md',
  style,
  ...props
}: Props) {
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : 48;
  const textStyle = size === 'sm' ? votingTypography.labelMd : votingTypography.bodyMd;

  const bg =
    variant === 'gold'
      ? votingColors.gold.container
      : variant === 'outline'
        ? 'transparent'
        : 'transparent';

  const textColor =
    variant === 'gold'
      ? votingColors.gold.on
      : variant === 'outline'
        ? votingColors.gold.DEFAULT
        : votingColors.onSurface;

  const borderColor =
    variant === 'outline' ? votingColors.gold.DEFAULT : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          height,
          borderRadius: votingRadius.md,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          backgroundColor: bg,
          borderWidth: variant === 'outline' ? 2 : 0,
          borderColor,
          opacity: disabled || loading ? 0.55 : pressed ? 0.85 : 1,
          // Subtle press shadow for gold button
          ...(variant === 'gold' && !disabled
            ? {
                shadowColor: votingColors.gold.DEFAULT,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: pressed ? 0.1 : 0.35,
                shadowRadius: 12,
                elevation: 6,
              }
            : {}),
        },
        style as object,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[textStyle, { color: textColor, fontWeight: '700' }]}>{title}</Text>
      )}
    </Pressable>
  );
}
