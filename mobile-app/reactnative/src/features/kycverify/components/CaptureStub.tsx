import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CheckCircle2, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { stubCaptureBase64 } from '../draft';

interface Props {
  label: string;
  hint?: string;
  /** Distinguishes the deterministic stub payload (e.g. "selfie", "doc-front"). */
  captureKind: string;
  captured: boolean;
  /** Called with the produced base64 stub. Real SDK output plugs in here. */
  onCaptured: (base64: string) => void;
  round?: boolean;
}

/**
 * Sandbox capture tile. Simulates a provider SDK capture (Smile SmartSelfie /
 * Youverify liveness / document scan) and emits a deterministic base64 stub.
 *
 * ── REAL SDK INTEGRATION ──────────────────────────────────────────────────
 * Replace `stubCaptureBase64(...)` below with the provider SDK launch:
 *   const result = await SmileID.captureSelfie({ token });   // server-issued
 *   onCaptured(result.selfieBase64);
 * The server-issued token comes from useSdkToken()/getSdkToken — no secret here.
 */
export default function CaptureStub({ label, hint, captureKind, captured, onCaptured, round }: Props) {
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (busy) return;
    setBusy(true);
    // Simulate SDK capture latency; real SDK resolves a base64/URI here.
    setTimeout(() => {
      onCaptured(stubCaptureBase64(captureKind));
      setBusy(false);
    }, 1200);
  };

  return (
    <Pressable
      onPress={run}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${label}${captured ? ', captured' : ', tap to capture'}`}
      style={({ pressed }) => [
        styles.tile,
        round && styles.round,
        captured && styles.tileDone,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, captured && styles.iconDone]}>
        {busy ? (
          <ActivityIndicator color={Colors.primary} />
        ) : captured ? (
          <CheckCircle2 size={26} color={Colors.teal} strokeWidth={2} />
        ) : (
          <Camera size={26} color={Colors.secondary} strokeWidth={2} />
        )}
      </View>
      <Text style={styles.label}>{captured ? 'Captured' : busy ? 'Capturing…' : label}</Text>
      {hint && !captured ? <Text style={styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    padding: Spacing.lg,
    minHeight: 140,
  },
  round: { borderRadius: Radius.xxl, minHeight: 200 },
  tileDone: { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.surfaceContainerLow },
  pressed: { opacity: 0.85 },
  icon: {
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center',
  },
  iconDone: { backgroundColor: Colors.iconBgTeal },
  label: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'center' },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
