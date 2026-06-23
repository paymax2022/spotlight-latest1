/**
 * Dark screen wrapper for all voting/contest screens.
 * Replaces AppScreen for the Spotlight voting UI.
 */
import { ReactNode } from 'react';
import { RefreshControlProps, ScrollView, StatusBar, StyleProp, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { votingColors, votingSpacing } from '@/theme/voting';

interface Props {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Set to false for modal-style screens that shouldn't scroll */
  scrollable?: boolean;
  /** Padding override */
  padding?: number;
}

export function VotingScreen({
  children,
  refreshControl,
  contentStyle,
  scrollable = true,
  padding = votingSpacing.margin,
}: Props) {
  const inner = (
    <View style={[{ padding, gap: votingSpacing.lg, paddingBottom: votingSpacing.xxl }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" backgroundColor={votingColors.bg.base} />
      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          contentContainerStyle={{ paddingBottom: votingSpacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ padding, gap: votingSpacing.lg }}>{children}</View>
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
