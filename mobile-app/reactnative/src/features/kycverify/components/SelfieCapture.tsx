import React, { useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera, CameraOff, RotateCcw } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  /** Raw base64 JPEG (no data: prefix) — what the verification providers expect. */
  onCaptured: (base64: string) => void;
  onReset: () => void;
}

const SIZE = 260;

/** Provider APIs want bare base64; web can hand back a full data URI. */
function stripDataUri(b64: string): string {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64;
}

/**
 * A real front-camera selfie. Replaces the sandbox stub that sent a fixed
 * placeholder string — which no liveness/face-match provider can confirm.
 */
export default function SelfieCapture({ onCaptured, onReset }: Props) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<{ uri: string } | null>(null);
  const [error, setError] = useState<string | undefined>();

  const capture = async () => {
    if (!camera.current || !ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const pic = await camera.current.takePictureAsync({ base64: true, quality: 0.6, skipProcessing: false });
      if (!pic?.base64) throw new Error('empty capture');
      setShot({ uri: pic.uri });
      onCaptured(stripDataUri(pic.base64));
    } catch {
      setError("Couldn't take the photo. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    setShot(null);
    setReady(false);
    onReset();
  };

  if (!permission) {
    return (
      <View style={[styles.frame, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={styles.wrap}>
        <View style={[styles.frame, styles.center]}>
          <CameraOff size={36} color={Colors.onSurfaceVariant} strokeWidth={1.6} />
          <Text style={styles.msg}>
            {blocked ? 'Camera access is blocked. Enable it in your browser or phone settings, then reload.' : 'We need your camera to take a live selfie.'}
          </Text>
        </View>
        {!blocked ? (
          <Pressable onPress={requestPermission} style={styles.btn} accessibilityRole="button">
            <Camera size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.btnText}>Allow camera</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.frame}>
        {shot ? (
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Your selfie" />
        ) : (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="front"
            onCameraReady={() => setReady(true)}
            onMountError={() => setError("Couldn't start the camera.")}
          />
        )}
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      {shot ? (
        <Pressable onPress={retake} style={[styles.btn, styles.btnGhost]} accessibilityRole="button">
          <RotateCcw size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={[styles.btnText, { color: Colors.primary }]}>Retake</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={capture}
          disabled={!ready || busy}
          style={[styles.btn, (!ready || busy) && styles.btnOff]}
          accessibilityRole="button"
          accessibilityLabel="Take selfie"
        >
          {busy ? <ActivityIndicator color={Colors.onPrimary} /> : <Camera size={18} color={Colors.onPrimary} strokeWidth={2} />}
          <Text style={styles.btnText}>{busy ? 'Capturing…' : ready ? 'Take selfie' : 'Starting camera…'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.md },
  frame: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerHigh, borderWidth: 3, borderColor: Colors.outlineVariant,
  },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  msg: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 12, paddingHorizontal: Spacing.xl,
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  btnOff: { opacity: 0.55 },
  btnText: { ...Typography.labelLg, color: Colors.onPrimary },
});
