// @ts-nocheck
// Join estate by scanning an invite QR code
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { joinWithInviteCode } from '@/api/estate.api';
import { colors } from '@/theme';

export default function JoinWithQRScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const scanLock = useRef(false);

  const joinMutation = useMutation({
    mutationFn: (c: string) => joinWithInviteCode(c),
    onSuccess: () => setSuccess(true),
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setError(err?.response?.data?.error || 'Invalid or expired code.');
      scanLock.current = false;
    },
  });

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanned(true);
    setCode(data);
    joinMutation.mutate(data);
  };

  const handleManualJoin = () => {
    const trimmed = code.trim();
    if (!trimmed || joinMutation.isPending) return;
    scanLock.current = true;
    joinMutation.mutate(trimmed);
  };

  const handleRetry = () => {
    setScanned(false);
    setError(null);
    scanLock.current = false;
  };

  if (success) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Ionicons name="checkmark-circle" size={72} color="#00B894" />
        <Text style={styles.successTitle}>Welcome!</Text>
        <Text style={styles.successSub}>You have joined the estate successfully.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/estate' as never)}>
          <Text style={styles.primaryBtnText}>Go to Estate</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Camera viewfinder */}
      <View style={styles.viewfinder}>
        {!permission ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : !permission.granted ? (
          <View style={styles.permissionBox}>
            <Ionicons name="camera-outline" size={56} color="rgba(255,255,255,0.7)" />
            <Text style={styles.permissionText}>Camera access is needed to scan QR codes.</Text>
            <Pressable style={styles.primaryBtn} onPress={requestPermission}>
              <Text style={styles.primaryBtnText}>Allow Camera</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            <View style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.scanHint}>Point your camera at the estate QR code</Text>
            </View>
          </>
        )}

        {joinMutation.isPending && (
          <View style={styles.processingBox}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.processingText}>Joining estate…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#fff" />
            <Text style={styles.errorBannerText}>{error}</Text>
            <Pressable onPress={handleRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Manual entry fallback */}
      <View style={styles.manualSection}>
        <Text style={styles.manualLabel}>Or enter the code manually:</Text>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.manualInput}
            placeholder="Paste invite code"
            placeholderTextColor={colors.neutral.placeholder}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.manualBtn, (!code.trim() || joinMutation.isPending) && { opacity: 0.5 }]}
            disabled={!code.trim() || joinMutation.isPending}
            onPress={handleManualJoin}
          >
            <Text style={styles.manualBtnText}>Join</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.8)',
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  viewfinder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  scanFrame: {
    width: 240, height: 240, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 20, marginBottom: 20,
  },
  scanHint: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  permissionBox: { alignItems: 'center', gap: 16, padding: 32 },
  permissionText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  processingBox: { position: 'absolute', bottom: 20, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: 12, borderRadius: 12 },
  processingText: { color: '#fff', fontSize: 14 },
  errorBanner: {
    position: 'absolute', bottom: 20, flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: 'rgba(220,38,38,0.9)', padding: 12, borderRadius: 12, marginHorizontal: 20,
  },
  errorBannerText: { color: '#fff', fontSize: 13, flex: 1 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  manualSection: { backgroundColor: colors.neutral.surface, padding: 20 },
  manualLabel: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 10 },
  manualRow: { flexDirection: 'row', gap: 10 },
  manualInput: {
    flex: 1, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 12,
    fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border,
  },
  manualBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  manualBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successTitle: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  successSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
});
