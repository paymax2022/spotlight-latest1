// ── ConfirmHost — web renderer for confirmAsync / alertAsync ─────────────────
// Mounted once at the app root. Subscribes to the confirm request store and
// renders pending requests as an in-app modal styled with the app design tokens
// (mirrors VoteConfirmationSheet). On native, Alert.alert handles everything, so
// this host renders nothing there.

import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Platform } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';
import { subscribeConfirm, resolveConfirm, type ConfirmRequest } from '@/lib/confirm';

export default function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);

  useEffect(() => subscribeConfirm(setQueue), []);

  // Only the web build needs the in-app renderer; native uses Alert.alert.
  if (Platform.OS !== 'web') return null;

  const req = queue[0];
  const visible = !!req;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => req && resolveConfirm(req.id, false)}>
      <View style={styles.overlay}>
        {/* Tapping the backdrop cancels (confirm) or dismisses (alert). */}
        <Pressable
          style={styles.backdrop}
          onPress={() => req && resolveConfirm(req.id, false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        {req ? (
          <View style={[styles.dialog, shadow3]} accessibilityViewIsModal accessibilityRole="alert">
            <Text style={styles.title}>{req.title}</Text>
            {req.message ? <Text style={styles.message}>{req.message}</Text> : null}
            <View style={styles.actions}>
              {req.mode === 'confirm' ? (
                <Pressable
                  onPress={() => resolveConfirm(req.id, false)}
                  style={[styles.btn, styles.cancelBtn]}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelLabel}>{req.cancelLabel}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => resolveConfirm(req.id, true)}
                style={[styles.btn, req.destructive ? styles.destructiveBtn : styles.confirmBtn]}
                accessibilityRole="button"
              >
                <Text style={styles.confirmLabel}>{req.confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.md },
  btn: { minWidth: 96, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: Colors.surfaceContainerHigh },
  confirmBtn: { backgroundColor: Colors.primary },
  destructiveBtn: { backgroundColor: Colors.error },
  cancelLabel: { ...Typography.labelLg, color: Colors.onSurface },
  confirmLabel: { ...Typography.labelLg, color: Colors.onPrimary },
});
