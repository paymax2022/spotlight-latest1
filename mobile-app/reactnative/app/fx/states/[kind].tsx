import React from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { EDGE_STATES, type EdgeAction } from '@/features/fx/constants/fx.constants';

/**
 * Registry-driven global edge/error state screen (spec L). One screen renders
 * every edge state from EDGE_STATES, reusing the shared StateView block plus an
 * optional secondary action. Reachable as /fx/states/<kind>.
 */
export default function EdgeStateScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const def = EDGE_STATES[kind ?? ''] ?? EDGE_STATES['server-error'];

  // Some states are full-screen takeovers without a back affordance.
  const noBack = kind === 'session-expired' || kind === 'maintenance' || kind === 'app-update';

  const run = (action: EdgeAction) => {
    switch (action) {
      case 'retry': router.canGoBack() ? goBack('/fx') : router.replace('/fx'); break;
      case 'login': router.replace('/(auth)/login'); break;
      case 'kyc': router.replace('/fx/kyc'); break;
      case 'status': router.replace('/fx/kyc/status'); break;
      case 'home': router.dismissTo('/fx'); break;
      case 'update': Share.share({ message: 'Update Spotlight from your app store to continue.' }).catch(() => {}); break;
      case 'support': Share.share({ message: 'Spotlight FX support: support@spotlight.ng' }).catch(() => {}); break;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="" showBack={!noBack} />
      <StateView
        kind={def.kindStyle}
        icon={def.icon}
        title={def.title}
        message={def.message}
        actionLabel={def.primaryLabel}
        onAction={() => run(def.primaryAction)}
      />
      {def.secondaryLabel && def.secondaryAction ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Pressable onPress={() => run(def.secondaryAction!)} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>{def.secondaryLabel}</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  secondary: { alignItems: 'center', paddingVertical: Spacing.sm },
  secondaryText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
});
