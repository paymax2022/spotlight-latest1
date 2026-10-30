import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScanLine, CheckCircle2, XCircle, Camera, CameraOff, Keyboard } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useValidateBoarding } from '@/features/mobility/hooks/useBusMarketplace';
import {
  boardingVerdict, classifyValidateError, normalizeQrPayload, type BoardingVerdict,
} from '@/features/mobility/utils/busBoarding';

// Operator boarding check: scans the passenger's ticket QR (the bare
// server-issued code rendered by app/mobility/bus/ticket/[id].tsx) and calls
// POST /driver/bus/validate. Unlike the events steward scan there is no offline
// mode: boarding is a server compare-and-swap, so an unreachable server is
// reported as "nothing validated" rather than optimistically admitting anyone.
const OK = { color: Colors.teal, bg: Colors.iconBgTeal };
const WARN = { color: Colors.onWarning, bg: Colors.iconBgGold };
const BAD = { color: Colors.error, bg: Colors.errorContainer };

const toneFor = (v: BoardingVerdict) =>
  v.ok ? OK : v.outcome === 'already_boarded' || v.outcome === 'not_open' || v.outcome === 'offline' ? WARN : BAD;

export default function BusBoardingScan() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId?: string }>();
  const validate = useValidateBoarding(scheduleId);
  const [manual, setManual] = useState('');
  const [verdict, setVerdict] = useState<BoardingVerdict | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanning = useRef(false);

  const run = async (code: string) => {
    setVerdict(null);
    setParseError(null);
    try {
      await validate.mutateAsync(code);
      setVerdict(boardingVerdict('boarded'));
    } catch (e) {
      setVerdict(classifyValidateError(e));
    }
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    // Hold the result on screen until the operator taps "Scan next", so one
    // QR held in front of the camera is not re-submitted on every frame.
    if (scanning.current || verdict) return;
    const code = normalizeQrPayload(data);
    if (!code) { setParseError("That QR isn't a bus ticket."); return; }
    scanning.current = true;
    run(code).finally(() => { scanning.current = false; });
  };

  const submitManual = () => {
    const code = normalizeQrPayload(manual);
    if (!code) { setParseError('Enter the ticket code exactly as shown under the passenger’s QR.'); return; }
    run(code);
  };

  const reset = () => { setVerdict(null); setManual(''); setParseError(null); };
  const cameraGranted = permission?.granted ?? false;
  const tone = verdict ? toneFor(verdict) : OK;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Board passengers" subtitle="Scan ticket QR codes" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.viewfinder}>
          {cameraGranted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={verdict || validate.isPending ? undefined : onBarcodeScanned}
            />
          ) : (
            <>
              <Camera size={36} color={Colors.inverseOnSurface} strokeWidth={1.4} />
              {permission && !permission.granted && !permission.canAskAgain ? (
                <Text style={styles.viewfinderText}>Camera access denied — enable it in Settings, or enter the code below</Text>
              ) : (
                <Pressable onPress={requestPermission} style={styles.grantBtn} accessibilityRole="button">
                  <CameraOff size={18} color={Colors.teal} strokeWidth={1.8} />
                  <Text style={styles.grantText}>Grant camera access</Text>
                </Pressable>
              )}
            </>
          )}
          <View style={styles.scanFrame} pointerEvents="none">
            <ScanLine size={40} color={Colors.teal} strokeWidth={1.4} />
          </View>
          {cameraGranted ? <Text style={styles.viewfinderCaption}>Point the camera at the passenger's ticket QR</Text> : null}
        </View>

        {verdict ? (
          <View style={[styles.resultCard, { backgroundColor: tone.bg }]} accessibilityLiveRegion="polite">
            {verdict.ok ? <CheckCircle2 size={44} color={tone.color} /> : <XCircle size={44} color={tone.color} />}
            <Text style={[styles.resultTitle, { color: tone.color }]}>{verdict.title}</Text>
            <Text style={styles.resultMeta}>{verdict.message}</Text>
            <Pressable onPress={reset} style={styles.nextBtn} accessibilityRole="button">
              <Text style={styles.nextText}>Scan next</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.manualHeader}>
          <Keyboard size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.or}>Can't scan? Enter the ticket code</Text>
        </View>
        <TextInputField placeholder="Ticket code" autoCapitalize="none" autoCorrect={false} value={manual} onChangeText={setManual} />
        {parseError ? <Text style={styles.parseError}>{parseError}</Text> : null}
        <PrimaryButton label="Validate" loading={validate.isPending} disabled={!manual.trim() || validate.isPending} onPress={submitManual} />

        <Text style={styles.hint}>Boarding opens 3 hours before departure. Each ticket can board once; cancelled or refunded tickets are rejected.</Text>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  viewfinder: { height: 240, borderRadius: Radius.xl, backgroundColor: Colors.backdropDark, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, overflow: 'hidden' },
  viewfinderText: { ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center', paddingHorizontal: Spacing.lg },
  viewfinderCaption: { position: 'absolute', bottom: 12, left: 16, right: 16, ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center' },
  scanFrame: { position: 'absolute', width: 120, height: 120, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.teal, alignItems: 'center', justifyContent: 'center' },
  grantBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  grantText: { ...Typography.labelMd, color: Colors.teal },
  manualHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  or: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  parseError: { ...Typography.bodySm, color: Colors.error },
  resultCard: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  resultTitle: { ...Typography.headlineMd },
  resultMeta: { ...Typography.bodyMd, color: Colors.onSurface, textAlign: 'center' },
  nextBtn: { marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest },
  nextText: { ...Typography.labelMd, color: Colors.onSurface },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
