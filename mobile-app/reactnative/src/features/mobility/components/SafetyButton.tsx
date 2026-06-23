import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { ShieldAlert, Share2, X, PhoneCall } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow3 } from '@/constants/shadows';

interface Props {
  onSos: () => Promise<void> | void;
  onShare?: () => void;
  sosPending?: boolean;
  variant?: 'bar' | 'fab';
}

/**
 * SOS + share-trip safety control (safety.md → SOS button, live sharing).
 * Triggering SOS confirms first, then creates a SafetyIncident via the caller.
 */
export default function SafetyButton({ onSos, onShare, sosPending, variant = 'bar' }: Props) {
  const [confirm, setConfirm] = useState(false);

  const handleConfirm = async () => {
    await onSos();
    setConfirm(false);
  };

  return (
    <>
      {variant === 'bar' ? (
        <View style={styles.bar}>
          {onShare && (
            <Pressable style={styles.shareBtn} onPress={onShare} accessibilityLabel="Share trip">
              <Share2 size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.shareLabel}>Share trip</Text>
            </Pressable>
          )}
          <Pressable style={styles.sosBtn} onPress={() => setConfirm(true)} accessibilityLabel="Emergency SOS">
            <ShieldAlert size={18} color={Colors.white} strokeWidth={2.2} />
            <Text style={styles.sosLabel}>SOS</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.fab, shadow3]} onPress={() => setConfirm(true)} accessibilityLabel="Emergency SOS">
          <ShieldAlert size={22} color={Colors.white} strokeWidth={2.2} />
        </Pressable>
      )}

      <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, shadow3]}>
            <Pressable style={styles.close} onPress={() => setConfirm(false)} hitSlop={8}>
              <X size={20} color={Colors.onSurfaceVariant} />
            </Pressable>
            <View style={styles.sosIcon}>
              <ShieldAlert size={30} color={Colors.error} strokeWidth={2} />
            </View>
            <Text style={styles.sheetTitle}>Trigger emergency SOS?</Text>
            <Text style={styles.sheetBody}>
              This alerts Paymax safety, shares your live location, and opens a safety case. Only use it in a genuine emergency.
            </Text>
            <Pressable style={styles.confirmBtn} onPress={handleConfirm} disabled={sosPending}>
              {sosPending
                ? <ActivityIndicator color={Colors.white} />
                : (
                  <>
                    <PhoneCall size={18} color={Colors.white} strokeWidth={2.2} />
                    <Text style={styles.confirmLabel}>Yes, send SOS now</Text>
                  </>
                )}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setConfirm(false)} disabled={sosPending}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: Spacing.sm },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.secondary },
  shareLabel: { ...Typography.labelMd, color: Colors.secondary },
  sosBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.error },
  sosLabel: { ...Typography.labelMd, color: Colors.white, fontWeight: '800' as const, letterSpacing: 1 },
  fab: { position: 'absolute', right: Spacing.containerMargin, bottom: 120, width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: Spacing.xl, alignItems: 'center' },
  close: { position: 'absolute', top: Spacing.md, right: Spacing.md, padding: 4 },
  sosIcon: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, marginTop: Spacing.sm },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  sheetBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, marginBottom: Spacing.lg },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, width: '100%', height: 56, borderRadius: Radius.lg, backgroundColor: Colors.error },
  confirmLabel: { ...Typography.labelLg, color: Colors.white },
  cancelBtn: { marginTop: Spacing.sm, height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
