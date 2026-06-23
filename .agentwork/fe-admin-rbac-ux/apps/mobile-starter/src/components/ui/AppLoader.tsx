import { ActivityIndicator, View } from 'react-native';

import { colors } from '@/theme';

export function AppLoader() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background }}>
      <ActivityIndicator color={colors.primary.blue} size="large" />
    </View>
  );
}
