import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

type Kind = 'loading' | 'empty' | 'error';

interface Props {
  kind: Kind;
  title?: string;
  message?: string;
  icon?: string;                 // lucide name (empty/error)
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;             // render inline (no flex:1 centering)
}

/**
 * Shared loading / empty / error state block, reusable across modules so each
 * screen renders states consistently instead of re-styling them inline.
 */
export default function StateView({ kind, title, message, icon, actionLabel, onAction, compact }: Props) {
  const IconComponent =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[icon ?? ''] ??
    (kind === 'error' ? Icons.CloudOff : Icons.Inbox);

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      {kind === 'loading' ? (
        <>
          <ActivityIndicator size="large" color={Colors.primary} />
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      ) : (
        <>
          <View style={[styles.iconBox, kind === 'error' && styles.iconBoxError]}>
            <IconComponent
              size={30}
              color={kind === 'error' ? Colors.error : Colors.onSurfaceVariant}
              strokeWidth={1.8}
            />
          </View>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {actionLabel && onAction ? (
            <View style={styles.actionWrap}>
              <PrimaryButton label={actionLabel} onPress={onAction} fullWidth={false} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  compact: { flex: 0, paddingVertical: Spacing.xxl },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainer,
  },
  iconBoxError: { backgroundColor: Colors.errorContainer },
  title: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actionWrap: { marginTop: Spacing.xs },
});
