import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PackageOpen } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/**
 * Where the module guard sends a deep link into a module that is not published
 * in this environment.
 *
 * A real screen rather than a silent bounce to home: a link that appears to do
 * nothing reads as a broken app. This says what happened and offers the way on,
 * and deliberately does NOT say "you don't have permission" — the module is not
 * live here for anyone, which is a different thing from a denial.
 */
export default function ModuleUnavailableScreen() {
  const { module: moduleName } = useLocalSearchParams<{ module?: string }>();
  const label = typeof moduleName === 'string' && moduleName.trim() ? moduleName.trim() : 'This service';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <PackageOpen size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
        </View>

        <Text style={styles.title} accessibilityRole="header">
          Not available yet
        </Text>
        <Text style={styles.body_}>
          {label} isn&apos;t live on Paymax yet. It&apos;ll appear here as soon as it launches —
          nothing is wrong with your account.
        </Text>

        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/home')}
          accessibilityRole="button"
          accessibilityLabel="Go to home"
        >
          <Text style={styles.primaryText}>Go to home</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryBtn}
          onPress={() => router.replace('/(tabs)/services')}
          accessibilityRole="button"
          accessibilityLabel="Browse available services"
        >
          <Text style={styles.secondaryText}>Browse services</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  iconWrap: {
    width: 68, height: 68, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body_: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.lg },
  primaryBtn: {
    height: 48, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  primaryText: { ...Typography.labelLg, color: Colors.onPrimary },
  secondaryBtn: { height: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  secondaryText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
