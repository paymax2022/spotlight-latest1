import { TextInput, TextInputProps, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing, typography } from '@/theme';

type Props = TextInputProps & {
  label: string;
  error?: string;
  variant?: 'text' | 'password';
};

export function AppInput({ label, error, variant, style, ...props }: Props) {
  return (
    <View style={{ gap: spacing[2] }}>
      <AppText variant="caption" color={colors.neutral.textMuted}>
        {label}
      </AppText>
      <TextInput
        placeholderTextColor={colors.neutral.placeholder}
        secureTextEntry={variant === 'password'}
        autoCapitalize="none"
        style={[
          typography.body,
          {
            minHeight: 52,
            borderWidth: 1,
            borderColor: error ? colors.secondary.red : colors.neutral.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing[4],
            backgroundColor: colors.neutral.white,
            color: colors.neutral.text
          },
          style
        ]}
        {...props}
      />
      {error ? (
        <AppText variant="caption" color={colors.secondary.red}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
