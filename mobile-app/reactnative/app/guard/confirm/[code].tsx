import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Camera, IdCard, Car, Check, X, ShieldAlert, User, MapPin, FileText, Clock, CircleCheck, Ban, Users, Repeat, LogOut,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StatusPill from '@/features/visitor/components/StatusPill';
import AttendanceStatus from '@/features/visitor/components/AttendanceStatus';
import { useApproveEntry, useCodeAttendance, useDenyEntry, useGateSession, useLookupCode, useRecordArrival, useRecordExit } from '@/features/visitor/hooks/useVisitor';
import { codeTypeMeta, DENY_REASONS } from '@/features/visitor/constants/visitor.constants';
import { formatCodeValue, formatDateTime } from '@/features/visitor/utils/visitorFormatters';
import type { AccessCode, LookupOutcome } from '@/features/visitor/types/visitor.types';

type Phase = 'looking' | 'result' | 'approved' | 'checkedout' | 'denied';

const FAIL_COPY: Record<string, { title: string; message: string; icon: string }> = {
  expired:   { title: 'Code expired', message: 'This access code is no longer valid. Ask the visitor for a fresh code or look up the resident.', icon: 'CalendarX' },
  used:      { title: 'Code already used', message: 'This single-use code has already admitted its visitor.', icon: 'Ban' },
  revoked:   { title: 'Code revoked', message: 'The resident revoked this code. Entry is not authorised.', icon: 'Ban' },
  not_found: { title: 'Invalid code', message: 'No matching code was found. Check the number and try again, or look up the resident.', icon: 'SearchX' },
};

export default function GuardConfirmScreen() {
  const { code: codeValue } = useLocalSearchParams<{ code: string }>();
  const session = useGateSession();
  const lookup = useLookupCode();
  const approve = useApproveEntry();
  const deny = useDenyEntry();
  const recordArrival = useRecordArrival();
  const recordExit = useRecordExit();

  const [phase, setPhase] = useState<Phase>('looking');
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);
  const [plate, setPlate] = useState('');
  const [photoCaptured, setPhotoCaptured] = useState(false);
  const [idCaptured, setIdCaptured] = useState(false);
  const [showDeny, setShowDeny] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const arrivedRef = React.useRef(false);

  const gateId = session.data?.gateId ?? 'gate_main';
  const okCode = outcome?.kind === 'ok' ? outcome.code : undefined;
  const attendance = useCodeAttendance(okCode?.id ?? '', { poll: true });
  const inside = !!attendance.data?.inside;

  useEffect(() => {
    if (!codeValue) return;
    lookup.mutate(codeValue, {
      onSuccess: (o) => {
        setOutcome(o);
        if (o.kind === 'ok' && o.code.visitor.vehiclePlate) setPlate(o.code.visitor.vehiclePlate);
        setPhase('result');
      },
      onError: () => { setOutcome({ kind: 'not_found', codeValue }); setPhase('result'); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeValue]);

  // VM-161: log arrival + notify resident the moment a valid code is queried.
  useEffect(() => {
    if (okCode && !arrivedRef.current) {
      arrivedRef.current = true;
      recordArrival.mutate({ accessCodeId: okCode.id, gateId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okCode?.id]);

  const onApprove = (code: AccessCode) => {
    approve.mutate(
      { accessCodeId: code.id, gateId, capture: { plate: plate || undefined, photoCaptured, idCaptured } },
      { onSuccess: () => setPhase('approved') },
    );
  };

  const onCheckOut = (code: AccessCode) => {
    recordExit.mutate({ accessCodeId: code.id, gateId }, { onSuccess: () => setPhase('checkedout') });
  };

  const onDeny = (code?: AccessCode) => {
    if (!denyReason) return;
    deny.mutate(
      { accessCodeId: code?.id, codeValue: codeValue ?? '', gateId, reason: denyReason },
      { onSuccess: () => setPhase('denied') },
    );
  };

  // ── Session error (no valid gate to log against) ────────────────────────────
  if (session.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verifying" />
        <StateView
          kind="error"
          title="Gate session unavailable"
          message="We couldn't confirm your gate session. Reconnect and try again."
          actionLabel="Retry"
          onAction={() => session.refetch()}
        />
      </SafeAreaView>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'looking' || session.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verifying" />
        <StateView kind="loading" message={`Looking up ${formatCodeValue(codeValue ?? '')}…`} />
      </SafeAreaView>
    );
  }

  // ── Approved / Denied success screens ───────────────────────────────────────
  if (phase === 'approved') {
    const name = outcome?.kind === 'ok' || outcome?.kind === 'blacklisted' ? outcome.code.visitor.name : 'Visitor';
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Entry approved" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.iconBgTeal }]}>
            <CircleCheck size={48} color={Colors.teal} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Checked in</Text>
          <Text style={styles.resultBody}>{name} has been admitted. The resident has been notified.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
          <PrimaryButton label="Scan next visitor" variant="secondary" onPress={() => router.replace('/guard/scan')} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'checkedout') {
    const name = okCode?.visitor.name ?? 'Visitor';
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checked out" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.iconBgBlue }]}>
            <LogOut size={48} color={Colors.secondary} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Checked out</Text>
          <Text style={styles.resultBody}>{name} has left the estate. The resident has been notified.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
          <PrimaryButton label="Scan next visitor" variant="secondary" onPress={() => router.replace('/guard/scan')} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'denied') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Entry denied" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.errorContainer }]}>
            <Ban size={48} color={Colors.error} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Entry denied</Text>
          <Text style={styles.resultBody}>Logged with reason: “{denyReason}”. The resident has been notified.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Result: failure outcomes ────────────────────────────────────────────────
  if (outcome && outcome.kind !== 'ok' && outcome.kind !== 'blacklisted') {
    const f = FAIL_COPY[outcome.kind];
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verification" />
        <StateView
          kind="error"
          icon={f.icon}
          title={f.title}
          message={f.message}
          actionLabel="Look up another"
          onAction={() => router.replace('/guard/scan')}
        />
      </SafeAreaView>
    );
  }

  // ── Result: blacklisted alert (VM-241) ──────────────────────────────────────
  if (outcome && outcome.kind === 'blacklisted') {
    const code = outcome.code;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Security alert" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.blacklistBanner}>
            <ShieldAlert size={26} color={Colors.onError} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blacklistTitle}>Blacklisted visitor</Text>
              <Text style={styles.blacklistBody}>{code.visitor.blacklistReason ?? 'This visitor is flagged. Do not admit. Escalate to security.'}</Text>
            </View>
          </View>
          <DetailsCard code={code} />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Deny & escalate" variant="primary" onPress={() => { setDenyReason('Visitor on blacklist'); onDeny(code); }} loading={deny.isPending} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Result: OK — full confirmation + capture + approve/deny ──────────────────
  const code = (outcome as Extract<LookupOutcome, { kind: 'ok' }>).code;
  const meta = codeTypeMeta(code.codeType);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm entry" rightSlot={<StatusPill status="active" />} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Purpose banner */}
        <View style={[styles.purposeBanner, { backgroundColor: meta.bg }]}>
          <Text style={[styles.purposeLabel, { color: meta.accent }]}>{meta.label.toUpperCase()}</Text>
          <Text style={styles.purposeName}>{code.visitor.name}</Text>
          <Text style={styles.purposeMeta}>
            {code.partySize} {code.partySize === 1 ? 'guest' : 'guests'} · {code.usageMode === 'one_time' ? 'One-time entry' : 'Entry & exit'}
          </Text>
        </View>

        {/* Live attendance — visible to the guard on query */}
        {attendance.data ? <AttendanceStatus attendance={attendance.data} usageMode={code.usageMode} /> : null}

        <DetailsCard code={code} />

        {!showDeny && inside ? (
          <View style={styles.exitNote}>
            <LogOut size={18} color={Colors.secondary} strokeWidth={1.8} />
            <Text style={styles.exitNoteText}>This visitor is currently inside. Record their exit to check them out.</Text>
          </View>
        ) : !showDeny ? (
          <>
            {/* Capture (VM-209) */}
            <Text style={styles.sectionLabel}>Capture (optional)</Text>
            <View style={styles.captureRow}>
              <CaptureToggle icon={<Camera size={20} />} label="Photo" active={photoCaptured} onPress={() => setPhotoCaptured((v) => !v)} />
              <CaptureToggle icon={<IdCard size={20} />} label="ID" active={idCaptured} onPress={() => setIdCaptured((v) => !v)} />
            </View>
            <TextInputField
              label="Vehicle plate"
              placeholder="LAS-123-AA"
              value={plate}
              onChangeText={(v) => setPlate(v.toUpperCase())}
              autoCapitalize="characters"
              leftIcon={<Car size={18} color={Colors.outline} />}
            />
          </>
        ) : (
          <>
            {/* Deny reason picker (VM-208) */}
            <Text style={styles.sectionLabel}>Reason for denial</Text>
            <View style={styles.reasonWrap}>
              {DENY_REASONS.map((r) => {
                const selected = r === denyReason;
                return (
                  <Pressable key={r} onPress={() => setDenyReason(r)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.reasonChip, selected && styles.reasonChipSelected]}>
                    <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Footer: approve / deny */}
      <View style={styles.footer}>
        {!showDeny ? (
          <View style={styles.actionRow}>
            <Pressable onPress={() => setShowDeny(true)} accessibilityRole="button" style={({ pressed }) => [styles.denyBtn, pressed && { opacity: 0.85 }]}>
              <X size={20} color={Colors.error} strokeWidth={2.4} />
              <Text style={styles.denyText}>Deny</Text>
            </Pressable>
            {inside ? (
              <Pressable onPress={() => onCheckOut(code)} accessibilityRole="button" disabled={recordExit.isPending} style={({ pressed }) => [styles.checkoutBtn, pressed && { opacity: 0.9 }, recordExit.isPending && { opacity: 0.6 }]}>
                <LogOut size={20} color={Colors.onPrimary} strokeWidth={2.4} />
                <Text style={styles.approveText}>{recordExit.isPending ? 'Checking out…' : 'Check out'}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => onApprove(code)} accessibilityRole="button" disabled={approve.isPending} style={({ pressed }) => [styles.approveBtn, pressed && { opacity: 0.9 }, approve.isPending && { opacity: 0.6 }]}>
                <Check size={20} color={Colors.onPrimary} strokeWidth={2.4} />
                <Text style={styles.approveText}>{approve.isPending ? 'Admitting…' : 'Approve entry'}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.actionRow}>
            <Pressable onPress={() => { setShowDeny(false); setDenyReason(''); }} accessibilityRole="button" style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.cancelText}>Back</Text>
            </Pressable>
            <Pressable onPress={() => onDeny(code)} accessibilityRole="button" disabled={!denyReason || deny.isPending} style={({ pressed }) => [styles.confirmDenyBtn, (!denyReason || deny.isPending) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
              <Text style={styles.confirmDenyText}>{deny.isPending ? 'Logging…' : 'Confirm denial'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function DetailsCard({ code }: { code: AccessCode }) {
  return (
    <View style={styles.detailCard}>
      <Row icon={<User size={16} color={Colors.onSurfaceVariant} />} label="Visitor" value={code.visitor.name} />
      <Row icon={<MapPin size={16} color={Colors.onSurfaceVariant} />} label="Host" value={`${code.hostName} · ${code.unitLabel}`} />
      <Row icon={<Users size={16} color={Colors.onSurfaceVariant} />} label="Guests" value={`${code.partySize} ${code.partySize === 1 ? 'guest' : 'guests'}`} />
      <Row icon={<Repeat size={16} color={Colors.onSurfaceVariant} />} label="Usage" value={code.usageMode === 'one_time' ? 'One-time entry' : 'Entry & exit'} />
      {code.visitor.purpose ? <Row icon={<FileText size={16} color={Colors.onSurfaceVariant} />} label="Purpose" value={code.visitor.purpose} /> : null}
      <Row icon={<Clock size={16} color={Colors.onSurfaceVariant} />} label="Valid until" value={formatDateTime(code.validityEnd)} />
      <Row label="Code" value={formatCodeValue(code.codeValue)} />
      {code.visitor.vehiclePlate ? <Row label="Vehicle" value={code.visitor.vehiclePlate} /> : null}
    </View>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        {icon}
        <Text style={styles.rowLabelText}>{label}</Text>
      </View>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function CaptureToggle({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.capture, active && styles.captureActive]}>
      <View style={[styles.captureIcon, active && styles.captureIconActive]}>
        {React.isValidElement(icon)
          ? React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color: active ? Colors.onPrimary : Colors.secondary })
          : icon}
      </View>
      <Text style={[styles.captureLabel, active && { color: Colors.primary }]}>{active ? `${label} ✓` : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  purposeBanner: { borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  purposeLabel: { ...Typography.labelSm, letterSpacing: 1, fontWeight: '700' },
  purposeName: { ...Typography.headlineMd, color: Colors.onSurface },
  purposeMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  exitNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md },
  exitNoteText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  detailCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 90 },
  rowLabelText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.xs },
  captureRow: { flexDirection: 'row', gap: Spacing.md },
  capture: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  captureActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  captureIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  captureIconActive: { backgroundColor: Colors.primary },
  captureLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  reasonChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  reasonChipSelected: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  reasonText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  reasonTextSelected: { color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, gap: Spacing.sm,
  },
  actionRow: { flexDirection: 'row', gap: Spacing.md },
  denyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer },
  denyText: { ...Typography.labelLg, color: Colors.error },
  approveBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  checkoutBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.secondary },
  approveText: { ...Typography.labelLg, color: Colors.onPrimary },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  cancelText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  confirmDenyBtn: { flex: 1.4, alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: Radius.lg, backgroundColor: Colors.error },
  confirmDenyText: { ...Typography.labelLg, color: Colors.onError },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 96, height: 96, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  blacklistBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.error, borderRadius: Radius.lg, padding: Spacing.md },
  blacklistTitle: { ...Typography.titleMd, color: Colors.onError },
  blacklistBody: { ...Typography.bodySm, color: Colors.onError },
});
