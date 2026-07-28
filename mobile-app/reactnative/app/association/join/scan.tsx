import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ScanLine, Keyboard, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useValidateCode } from '@/features/association/hooks/useJoin';

export default function QrInviteScan() {
  const validate = useValidateCode('INVITE');

  // Camera/barcode capture is not wired in this build (no camera dependency).
  // "Simulate scan" runs the validation path so the flow is testable end-to-end.
  const onSimulate = () => {
    validate.mutate('NMA2026', {
      onSuccess: (res) => {
        if (res.valid && res.organisationId) router.replace(`/association/organisation/${res.organisationId}`);
        else Alert.alert('Invalid QR', res.message);
      },
      onError: () => Alert.alert('Scan failed', 'Could not read the code. Try entering it manually.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Scan invite QR" />
      <View style={styles.body}>
        {/* Viewfinder */}
        <View style={styles.viewfinder}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <View style={styles.scanIcon}>
            <ScanLine size={40} color={Colors.primary} strokeWidth={1.6} />
          </View>
        </View>

        <View style={styles.cameraHint}>
          <Camera size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.hint}>Point your camera at the organisation’s invite QR code.</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Simulate scan" onPress={onSimulate} loading={validate.isPending} />
        <Pressable onPress={() => router.replace('/association/join/invite')} style={styles.manualBtn} accessibilityRole="button" accessibilityLabel="Enter code manually">
          <Keyboard size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.manualText}>Enter code manually</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  viewfinder: { width: 240, height: 240, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: Colors.primary },
  tl: { top: 12, left: 12, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: Radius.md },
  tr: { top: 12, right: 12, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radius.md },
  bl: { bottom: 12, left: 12, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: Radius.md },
  br: { bottom: 12, right: 12, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: Radius.md },
  scanIcon: { opacity: 0.6 },
  cameraHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hint: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  manualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  manualText: { ...Typography.labelMd, color: Colors.secondary },
});
