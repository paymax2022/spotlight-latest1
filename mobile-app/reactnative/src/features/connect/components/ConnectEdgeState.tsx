import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

interface Props {
  icon: string;            // lucide name
  title: string;
  message: string;
  tone?: 'neutral' | 'error';
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Full-screen edge/error state for Connect (offline, maintenance, force-update,
 * geo-restriction, age-gate). Same token-driven surface as the shared StateView
 * but as a standalone page with up to two actions.
 */
export default function ConnectEdgeState({ icon, title, message, tone = 'neutral', primaryLabel, onPrimary, secondaryLabel, onSecondary }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.CircleAlert;
  const isError = tone === 'error';
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={[styles.iconBox, isError && styles.iconBoxError]}>
          <Icon size={40} color={isError ? Colors.error : Colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      {(primaryLabel || secondaryLabel) && (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {primaryLabel && onPrimary ? <PrimaryButton label={primaryLabel} onPress={onPrimary} /> : null}
          {secondaryLabel && onSecondary ? <PrimaryButton label={secondaryLabel} variant="ghost" onPress={onSecondary} /> : null}
        </SafeAreaView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconBoxError: { backgroundColor: Colors.errorContainer },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.md },
});
