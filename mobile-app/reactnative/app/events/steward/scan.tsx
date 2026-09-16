import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScanLine, CheckCircle2, XCircle, WifiOff, Camera, CameraOff, Keyboard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useValidateScan } from '@/features/events/hooks';
import { EventColors } from '@/features/events/constants/events.constants';
import type { ScanResult, GateToken, Gate } from '@/features/events/types';

const OUTCOME: Record<ScanResult['outcome'], { title: string; ok: boolean; color: string; bg: string }> = {
  'valid':       { title: 'Admit guest',     ok: true,  color: EventColors.ok,       bg: EventColors.okBg },
  'already-used':{ title: 'Already used',    ok: false, color: EventColors.warnText, bg: EventColors.warnBg },
  'invalid':     { title: 'Invalid ticket',  ok: false, color: EventColors.danger,   bg: EventColors.dangerBg },
  'wrong-event': { title: 'Wrong event',     ok: false, color: EventColors.danger,   bg: EventColors.dangerBg },
};

export default function StewardScan() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const validate = useValidateScan();
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanning = useRef(false);

  // v1: one default gate per event. Multi-gate management (named gates an
  // organiser configures) is a further feature, not built here.
  const gate: Gate = { id: `${eventId ?? 'unknown'}:main`, name: 'Main Entrance' };

  const scan = async (token: GateToken) => {
    setResult(null);
    setParseError(null);
    const res = await validate.mutateAsync({ token, gate });
    setResult(res);
  };

  // The QR encodes the real server-issued token as JSON (see
  // app/events/ticket/[id].tsx / GateToken) — never a bare credential id, so a
  // screenshot of someone typing digits can't forge a scan.
  const parseToken = (raw: string): GateToken | null => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cid === 'string' && typeof parsed.sig === 'string') return parsed as GateToken;
    } catch {
      // fall through
    }
    return null;
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanning.current) return;
    const token = parseToken(data);
    if (!token) {
      setParseError("That QR isn't a valid ticket pass.");
      return;
    }
    scanning.current = true;
    scan(token).finally(() => { setTimeout(() => { scanning.current = false; }, 1500); });
  };

  const submitPasted = () => {
    const token = parseToken(pasted.trim());
    if (!token) { setParseError("Couldn't read that as a ticket pass — paste the full code from the attendee's app."); return; }
    scan(token);
  };

  const cameraGranted = permission?.granted ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Scan tickets" subtitle="Steward check-in" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.viewfinder}>
          {cameraGranted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          ) : (
            <>
              <Camera size={36} color={Colors.inverseOnSurface} strokeWidth={1.4} />
              {permission && !permission.granted && !permission.canAskAgain ? (
                <Text style={styles.viewfinderText}>Camera access denied — enable it in Settings</Text>
              ) : (
                <Pressable onPress={requestPermission} style={styles.grantBtn} accessibilityRole="button">
                  <CameraOff size={18} color={EventColors.ok} strokeWidth={1.8} />
                  <Text style={styles.grantText}>Grant camera access</Text>
                </Pressable>
              )}
            </>
          )}
          <View style={styles.scanFrame} pointerEvents="none">
            <ScanLine size={40} color={EventColors.ok} strokeWidth={1.4} />
          </View>
          {cameraGranted ? <Text style={styles.viewfinderCaption}>Point camera at the attendee's QR pass</Text> : null}
        </View>

        <View style={styles.manualHeader}>
          <Keyboard size={16} color={EventColors.muted} strokeWidth={1.8} />
          <Text style={styles.or}>Can't scan? Paste the code from the attendee's app</Text>
        </View>
        <TextInputField placeholder="Paste ticket pass code" autoCapitalize="none" value={pasted} onChangeText={setPasted} />
        {parseError ? <Text style={styles.parseError}>{parseError}</Text> : null}
        <PrimaryButton label="Validate" loading={validate.isPending} disabled={!pasted.trim()} onPress={submitPasted} />

        {result ? (
          <View style={[styles.resultCard, { backgroundColor: OUTCOME[result.outcome].bg }]}>
            {OUTCOME[result.outcome].ok
              ? <CheckCircle2 size={44} color={OUTCOME[result.outcome].color} />
              : <XCircle size={44} color={OUTCOME[result.outcome].color} />}
            <Text style={[styles.resultTitle, { color: OUTCOME[result.outcome].color }]}>{OUTCOME[result.outcome].title}</Text>
            {result.holderName ? <Text style={styles.resultMeta}>{result.holderName} · {result.tierName}</Text> : null}
            {result.offline ? (
              <View style={styles.offlineChip}>
                <WifiOff size={13} color={EventColors.warnText} />
                <Text style={styles.offlineText}>Validated offline — will sync when online</Text>
              </View>
            ) : null}
            <Pressable onPress={() => { setResult(null); setPasted(''); setParseError(null); }} style={styles.nextBtn}>
              <Text style={styles.nextText}>Scan next</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.hint}>Scanning works offline. Tickets are validated against the cached attendee manifest and synced once a connection returns.</Text>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  viewfinder: { height: 220, borderRadius: Radius.xl, backgroundColor: Colors.backdropDark, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, overflow: 'hidden' },
  viewfinderText: { ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center', paddingHorizontal: Spacing.lg },
  viewfinderCaption: { position: 'absolute', bottom: 12, left: 16, right: 16, ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center' },
  scanFrame: { position: 'absolute', width: 120, height: 120, borderRadius: Radius.lg, borderWidth: 2, borderColor: EventColors.ok, alignItems: 'center', justifyContent: 'center' },
  grantBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  grantText: { ...Typography.labelMd, color: EventColors.ok },
  manualHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  or: { ...Typography.bodySm, color: EventColors.muted },
  parseError: { ...Typography.bodySm, color: EventColors.danger },
  resultCard: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  resultTitle: { ...Typography.headlineMd },
  resultMeta: { ...Typography.bodyMd, color: Colors.onSurface },
  offlineChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: EventColors.warnBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  offlineText: { ...Typography.caption, color: EventColors.warnText },
  nextBtn: { marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest },
  nextText: { ...Typography.labelMd, color: Colors.onSurface },
  hint: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
});
