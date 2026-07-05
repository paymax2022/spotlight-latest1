import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ScanLine, CheckCircle2, XCircle, WifiOff, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useValidateScan } from '@/features/events/hooks';
import { EventColors } from '@/features/events/constants/events.constants';
import type { ScanResult } from '@/features/events/types';

const OUTCOME: Record<ScanResult['outcome'], { title: string; ok: boolean; color: string; bg: string }> = {
  'valid':       { title: 'Admit guest',     ok: true,  color: EventColors.ok,       bg: EventColors.okBg },
  'already-used':{ title: 'Already used',    ok: false, color: EventColors.warnText, bg: EventColors.warnBg },
  'invalid':     { title: 'Invalid ticket',  ok: false, color: EventColors.danger,   bg: EventColors.dangerBg },
  'wrong-event': { title: 'Wrong event',     ok: false, color: EventColors.danger,   bg: EventColors.dangerBg },
};

export default function StewardScan() {
  useLocalSearchParams<{ eventId: string }>();
  const validate = useValidateScan();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);

  const scan = async (payload: string) => {
    setResult(null);
    const res = await validate.mutateAsync(payload);
    setResult(res);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Scan tickets" subtitle="Steward check-in" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Camera viewfinder placeholder (camera module not bundled). */}
        <View style={styles.viewfinder}>
          <Camera size={36} color={Colors.inverseOnSurface} strokeWidth={1.4} />
          <Text style={styles.viewfinderText}>Point camera at the attendee's QR pass</Text>
          <View style={styles.scanFrame}>
            <ScanLine size={40} color={EventColors.ok} strokeWidth={1.4} />
          </View>
        </View>

        <Text style={styles.or}>or enter the credential id manually</Text>
        <TextInputField placeholder="cred_xxxxxxxx" autoCapitalize="none" value={code} onChangeText={setCode} />
        <PrimaryButton label="Validate" loading={validate.isPending} onPress={() => scan(code || 'cred_9x2k')} />

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
            <Pressable onPress={() => { setResult(null); setCode(''); }} style={styles.nextBtn}>
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
  viewfinder: { height: 220, borderRadius: Radius.xl, backgroundColor: Colors.backdropDark, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  viewfinderText: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  scanFrame: { width: 120, height: 120, borderRadius: Radius.lg, borderWidth: 2, borderColor: EventColors.ok, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  or: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
  resultCard: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  resultTitle: { ...Typography.headlineMd },
  resultMeta: { ...Typography.bodyMd, color: Colors.onSurface },
  offlineChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: EventColors.warnBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  offlineText: { ...Typography.caption, color: EventColors.warnText },
  nextBtn: { marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest },
  nextText: { ...Typography.labelMd, color: Colors.onSurface },
  hint: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
});
