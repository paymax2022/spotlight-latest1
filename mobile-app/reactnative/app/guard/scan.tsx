import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScanLine, Keyboard, QrCode, CameraOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';

const DEMO_SCANS: { label: string; value: string }[] = [
  { label: 'Valid guest', value: '482913' },
  { label: 'Delivery', value: '730184' },
  { label: 'Expired', value: '204859' },
  { label: 'Already used', value: '556210' },
  { label: 'Revoked', value: '889001' },
  { label: 'Blacklisted', value: '660247' },
  { label: 'Unknown', value: '000000' },
];

export default function GuardScanScreen() {
  const [manual, setManual] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const scanning = useRef(false);

  const goConfirm = (value: string) => {
    const clean = value.replace(/\s/g, '');
    if (!clean) return;
    router.push(`/guard/confirm/${clean}`);
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanning.current) return;
    scanning.current = true;
    goConfirm(data);
    // reset lock after navigation completes so back-navigation works
    setTimeout(() => { scanning.current = false; }, 2000);
  };

  const cameraGranted = permission?.granted ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Scan visitor" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Viewfinder */}
          <View style={styles.viewfinder}>
            <View style={styles.cornerTL} />
            <View style={styles.cornerTR} />
            <View style={styles.cornerBL} />
            <View style={styles.cornerBR} />

            {cameraGranted ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcodeScanned}
              />
            ) : (
              <>
                <QrCode size={56} color={Colors.inverseOnSurface} strokeWidth={1.2} />
                {permission && !permission.granted && !permission.canAskAgain ? (
                  <Text style={styles.viewfinderText}>Camera access denied — enable it in Settings</Text>
                ) : (
                  <Pressable onPress={requestPermission} style={styles.grantBtn} accessibilityRole="button">
                    <CameraOff size={18} color={Colors.secondary} strokeWidth={1.8} />
                    <Text style={styles.grantText}>Grant camera access</Text>
                  </Pressable>
                )}
              </>
            )}

            <View style={styles.scanLine} />
            {cameraGranted && (
              <Text style={styles.viewfinderText}>Point the camera at the visitor's QR code</Text>
            )}
          </View>

          {/* Demo scans */}
          <Text style={styles.label}>Simulate a scan</Text>
          <View style={styles.demoRow}>
            {DEMO_SCANS.map((d) => (
              <Pressable key={d.value} onPress={() => goConfirm(d.value)} accessibilityRole="button" style={({ pressed }) => [styles.demoChip, pressed && { opacity: 0.8 }]}>
                <ScanLine size={14} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.demoText}>{d.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Manual entry (VM-203) */}
          <View style={styles.manualHeader}>
            <Keyboard size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.label}>Enter code manually</Text>
          </View>
          <TextInputField
            placeholder="6–8 digit code"
            value={manual}
            onChangeText={setManual}
            keyboardType="number-pad"
            maxLength={9}
            returnKeyType="search"
            onSubmitEditing={() => goConfirm(manual)}
          />
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label="Look up code" onPress={() => goConfirm(manual)} disabled={!manual.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  viewfinder: {
    height: 240,
    borderRadius: Radius.xl,
    backgroundColor: Colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    overflow: 'hidden',
  },
  scanLine: { position: 'absolute', left: 40, right: 40, height: 2, backgroundColor: Colors.secondary, top: '50%' },
  cornerTL: { position: 'absolute', top: 24, left: 24, width: 28, height: 28, borderTopWidth: 3, borderLeftWidth: 3, borderColor: Colors.inversePrimary, borderTopLeftRadius: Radius.md },
  cornerTR: { position: 'absolute', top: 24, right: 24, width: 28, height: 28, borderTopWidth: 3, borderRightWidth: 3, borderColor: Colors.inversePrimary, borderTopRightRadius: Radius.md },
  cornerBL: { position: 'absolute', bottom: 24, left: 24, width: 28, height: 28, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: Colors.inversePrimary, borderBottomLeftRadius: Radius.md },
  cornerBR: { position: 'absolute', bottom: 24, right: 24, width: 28, height: 28, borderBottomWidth: 3, borderRightWidth: 3, borderColor: Colors.inversePrimary, borderBottomRightRadius: Radius.md },
  viewfinderText: { position: 'absolute', bottom: 12, left: 16, right: 16, ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center' },
  grantBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  grantText: { ...Typography.labelMd, color: Colors.secondary },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  demoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  demoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  demoText: { ...Typography.labelMd, color: Colors.onSurface },
  manualHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow,
  },
});
