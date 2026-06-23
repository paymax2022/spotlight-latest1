import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Loader, PhoneIncoming, PhoneOutgoing, RefreshCw, PhoneOff, Hourglass, WifiOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { DoctorAvatar } from '@/features/telemedicine/components';
import type { CallPhase } from '@/types/doctor.batch2';

interface Props {
  phase:       CallPhase;
  patientName: string;
  initials:    string;
  avatarColor: string;
  modeLabel:   string;            // "Video consultation" / "Audio consultation"
  subline?:    string;            // provider / network note
}

// New component: the central call-stage visual that renders the patient avatar
// plus a phase-specific status (waiting room, ringing/incoming, connecting,
// reconnecting, dropped, ended). The base call.tsx inlined one connecting state;
// this consolidates every CallPhase variant in one reusable stage. Sits on the
// call gradient, so translucent backgrounds use rgba overlays (accepted
// exception).
const PHASE: Record<string, { Icon: typeof Loader; label: string; tone: 'idle' | 'warn' | 'bad' }> = {
  waiting_room: { Icon: Hourglass,     label: 'Waiting room',  tone: 'idle' },
  ringing:      { Icon: PhoneIncoming, label: 'Incoming…',     tone: 'idle' },
  connecting:   { Icon: PhoneOutgoing, label: 'Calling…',      tone: 'idle' },
  live:         { Icon: Loader,        label: 'Connected',     tone: 'idle' },
  reconnecting: { Icon: RefreshCw,     label: 'Reconnecting…', tone: 'warn' },
  dropped:      { Icon: WifiOff,       label: 'Call dropped',  tone: 'bad' },
  ended:        { Icon: PhoneOff,      label: 'Call ended',    tone: 'bad' },
  failed:       { Icon: PhoneOff,      label: 'Call failed',   tone: 'bad' },
};

export default function CallStageView({ phase, patientName, initials, avatarColor, modeLabel, subline }: Props) {
  const cfg = PHASE[phase] ?? PHASE.connecting;
  const Icon = cfg.Icon;

  return (
    <View style={styles.stage}>
      <DoctorAvatar initials={initials} color={avatarColor} size={120} />
      <Text style={styles.name}>{patientName}</Text>
      <Text style={styles.sub}>{modeLabel}</Text>

      <View style={[styles.phasePill, cfg.tone === 'warn' && styles.phaseWarn, cfg.tone === 'bad' && styles.phaseBad]}>
        <Icon size={14} color={Colors.white} strokeWidth={2.2} />
        <Text style={styles.phaseText}>{cfg.label}</Text>
      </View>

      {!!subline && <Text style={styles.subline}>{subline}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  stage:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  name:      { ...Typography.headlineMd, color: Colors.white, marginTop: Spacing.md },
  sub:       { ...Typography.bodyMd, color: 'rgba(255,255,255,0.7)' },
  phasePill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm, paddingHorizontal: Spacing.md, height: 32, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.16)' },
  phaseWarn: { backgroundColor: 'rgba(245,179,1,0.35)' },
  phaseBad:  { backgroundColor: 'rgba(186,26,26,0.45)' },
  phaseText: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  subline:   { ...Typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: Spacing.xs, textAlign: 'center', paddingHorizontal: Spacing.lg },
});
