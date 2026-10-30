import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';

/**
 * Shown in place of interactive estate/visitor services when the account has no
 * estate membership. Every estate feature is estate-scoped server-side, so the
 * only useful next step is registering an estate-manager account.
 */
export default function EstateAccessGate() {
  return (
    <View style={styles.card}>
      <View style={styles.icon}><Lock size={24} color={Colors.secondary} strokeWidth={1.8} /></View>
      <Text style={styles.title}>Estate account required</Text>
      <Text style={styles.body}>
        Your account isn’t linked to an estate yet, so estate and visitor services are
        unavailable. Create an estate account to invite visitors, pay dues and manage
        your estate.
      </Text>
      <PrimaryButton
        label="Create an estate account"
        onPress={() => router.push('/property/roles' as never)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  icon: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
});
