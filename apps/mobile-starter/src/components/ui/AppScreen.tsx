import { ReactNode } from 'react';
import { ScrollView, ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

type Props = ScrollViewProps & {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

export function AppScreen({ children, contentStyle, ...props }: Props) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.neutral.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ padding: spacing[5], gap: spacing[5] }, contentStyle]}
        {...props}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
