import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { X, Delete, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

type Mode = 'verify' | 'create';

interface Props {
  visible: boolean;
  mode: Mode;
  /** Called with the entered (and, in create mode, confirmed) 4-digit PIN. */
  onSubmit: (pin: string) => void;
  onClose: () => void;
  loading?: boolean;
  /** External error (e.g. "Incorrect PIN") shown beneath the dots. */
  error?: string | null;
  title?: string;
}

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * Reusable transaction-PIN sheet. In 'verify' mode it captures one 4-digit PIN
 * and submits. In 'create' mode it captures the PIN twice (enter → confirm) and
 * submits only when both match. This is the real gate before any transfer.
 */
export default function PinSheet({
  visible,
  mode,
  onSubmit,
  onClose,
  loading = false,
  error,
  title,
}: Props) {
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null); // create mode
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset whenever the sheet is (re)opened.
  useEffect(() => {
    if (visible) {
      setPin('');
      setFirstPin(null);
      setLocalError(null);
    }
  }, [visible]);

  const confirming = mode === 'create' && firstPin !== null;

  const heading =
    title ??
    (mode === 'create'
      ? confirming
        ? 'Confirm your PIN'
        : 'Create your transaction PIN'
      : 'Enter transaction PIN');

  const subtitle =
    mode === 'create'
      ? confirming
        ? 'Re-enter the 4-digit PIN to confirm.'
        : 'Set a 4-digit PIN to authorise transfers.'
      : 'Enter your 4-digit PIN to authorise this transfer.';

  const complete = (next: string) => {
    if (mode === 'create' && !confirming) {
      // first entry → ask to confirm
      setFirstPin(next);
      setPin('');
      setLocalError(null);
      return;
    }
    if (mode === 'create' && confirming) {
      if (next !== firstPin) {
        setLocalError('PINs do not match. Try again.');
        setFirstPin(null);
        setPin('');
        return;
      }
    }
    onSubmit(next);
  };

  const press = (key: string) => {
    if (loading) return;
    setLocalError(null);
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;
    setPin((p) => {
      if (p.length >= PIN_LENGTH) return p;
      const next = p + key;
      if (next.length === PIN_LENGTH) {
        // defer so the last dot renders before submit/transition
        setTimeout(() => complete(next), 120);
      }
      return next;
    });
  };

  const shownError = error ?? localError;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.header}>
            <View style={styles.lockBadge}>
              <ShieldCheck size={18} color={Colors.teal} strokeWidth={2.2} />
            </View>
            <Pressable
              onPress={loading ? undefined : onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>

          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.dots}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, !!shownError && styles.dotError]} />
            ))}
          </View>

          {shownError ? <Text style={styles.error}>{shownError}</Text> : <View style={styles.errorSpacer} />}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.loadingText}>Verifying…</Text>
            </View>
          ) : (
            <View style={styles.pad}>
              {KEYS.map((key, idx) => {
                if (key === '') return <View key={`spacer-${idx}`} style={styles.keyGhost} />;
                const isDel = key === 'del';
                return (
                  <Pressable
                    key={key}
                    onPress={() => press(key)}
                    accessibilityRole="button"
                    accessibilityLabel={isDel ? 'Delete' : key}
                    style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                  >
                    {isDel ? (
                      <Delete size={22} color={Colors.onSurface} strokeWidth={2} />
                    ) : (
                      <Text style={styles.keyText}>{key}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={styles.footnote}>Your PIN is never shared with recipients or providers.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockBadge: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm, textAlign: 'center' },
  subtitle: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, marginTop: Spacing.lg },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.transparent,
  },
  dotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotError: { borderColor: Colors.error },
  error: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm, minHeight: 16 },
  errorSpacer: { minHeight: 16, marginTop: Spacing.sm },
  loading: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
  loadingText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  key: {
    width: '30%',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
  },
  keyGhost: { width: '30%', height: 64, marginBottom: Spacing.sm },
  keyPressed: { backgroundColor: Colors.surfaceContainerHigh },
  keyText: { ...Typography.headlineMd, color: Colors.onSurface },
  footnote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.md },
});
