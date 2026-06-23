import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Mic, Wifi, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { usePreCallCheck, useRunDeviceCheck } from '@/features/doctor/hooks';
import { NETWORK_QUALITY_LABELS } from '@/features/doctor/constants';
import type { NetworkQuality, PreCallCheck } from '@/types/doctor.batch2';

const toBadgeTone = (q: NetworkQuality) => {
  const t = NETWORK_QUALITY_LABELS[q].tone;
  return (t === 'success' ? 'success' : t === 'warning' ? 'warning' : t === 'danger' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';
};

export default function PreCallScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const appointmentId = String(id);
  const callMode: 'audio' | 'video' = mode === 'audio' ? 'audio' : 'video';

  const { data: check, isLoading, isError, refetch } = usePreCallCheck(appointmentId);
  const runCheck = useRunDeviceCheck();
  const [latest, setLatest] = useState<PreCallCheck | null>(null);

  const current = latest ?? check;

  const doRunCheck = async () => {
    try {
      const res = await runCheck.mutateAsync({ appointmentId, mode: callMode });
      setLatest(res.check);
    } catch { /* surfaced via runCheck.isError */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pre-call checklist" />

      {isLoading && !current ? (
        <StateView variant="loading" label="Preparing device check" />
      ) : isError || !current ? (
        <StateView variant="error" message="We could not load the pre-call check." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>Run a quick device and network test before you join the {callMode} consultation.</Text>

          {/* Camera/mic test (I2) */}
          <SectionCard title="Camera & microphone" style={styles.card}>
            {callMode === 'video' && <CheckRow icon={Camera} label="Camera" ok={current.device.cameraOk} />}
            <CheckRow icon={Mic} label="Microphone" ok={current.device.micOk} border={callMode === 'video'} />
          </SectionCard>

          {/* Network quality test (I3) */}
          <SectionCard title="Network" style={styles.card}>
            <View style={styles.networkRow}>
              <View style={styles.networkLeft}>
                <View style={[styles.iconWrap, { backgroundColor: Colors.iconBgBlue }]}>
                  <Wifi size={18} color={Colors.secondary} strokeWidth={2} />
                </View>
                <Text style={styles.checkLabel}>Connection quality</Text>
              </View>
              <StatusBadge label={NETWORK_QUALITY_LABELS[current.device.networkQuality].label} tone={toBadgeTone(current.device.networkQuality)} />
            </View>
          </SectionCard>

          {/* Warnings */}
          {current.warnings.length > 0 && (
            <SectionCard title="Warnings" style={styles.card}>
              {current.warnings.map((w, i) => (
                <View key={w} style={[styles.warnRow, i > 0 && styles.rowBorder]}>
                  <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
                  <Text style={styles.warnText}>{w}</Text>
                </View>
              ))}
            </SectionCard>
          )}

          <View style={styles.readyRow}>
            {current.ready ? (
              <><CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} /><Text style={styles.readyText}>You're ready to join.</Text></>
            ) : (
              <><XCircle size={18} color={Colors.error} strokeWidth={2} /><Text style={styles.readyText}>Some checks need attention.</Text></>
            )}
          </View>

          <PrimaryButton label="Re-run device check" variant="secondary" onPress={doRunCheck} loading={runCheck.isPending} style={styles.btn} />
          <PrimaryButton
            label={callMode === 'video' ? 'Join video call' : 'Join audio call'}
            onPress={() => router.replace(`/(doctor)/consult/${appointmentId}/call?mode=${callMode}`)}
            disabled={!current.ready}
            style={styles.btn}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CheckRow({ icon: Icon, label, ok, border }: { icon: LucideIcon; label: string; ok: boolean; border?: boolean }) {
  return (
    <View style={[styles.checkRow, border && styles.rowBorder]}>
      <View style={styles.networkLeft}>
        <View style={[styles.iconWrap, { backgroundColor: Colors.iconBgPurple }]}>
          <Icon size={18} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.checkLabel}>{label}</Text>
      </View>
      {ok ? <CheckCircle2 size={20} color={Colors.teal} strokeWidth={2} /> : <XCircle size={20} color={Colors.error} strokeWidth={2} />}
    </View>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card:       { marginBottom: Spacing.md },
  checkRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  networkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  networkLeft:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconWrap:   { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { ...Typography.labelMd, color: Colors.onSurface },
  rowBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  warnRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  warnText:   { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  readyRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  readyText:  { ...Typography.labelMd, color: Colors.onSurface },
  btn:        { marginTop: Spacing.sm },
});
