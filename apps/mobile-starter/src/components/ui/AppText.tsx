import { Text, TextProps } from 'react-native';

import { colors, typography } from '@/theme';

type Props = TextProps & {
  variant?: keyof typeof typography;
  color?: string;
};

export function AppText({ variant = 'body', color = colors.neutral.text, style, ...props }: Props) {
  return <Text {...props} style={[typography[variant], { color }, style]} />;
}
