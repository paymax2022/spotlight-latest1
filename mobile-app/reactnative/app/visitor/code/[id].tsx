import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MessageCircle, Mail, Share2, Copy, Check, Ban, Clock, MapPin, User, Users, Repeat } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StatusPill from '@/features/visitor/components/StatusPill';
import QrCodeView from '@/features/visitor/components/QrCodeView';
import AttendanceStatus from '@/features/visitor/components/AttendanceStatus';
import { useAccessCode, useCodeAttendance, useRevokeAccessCode } from '@/features/visitor/hooks/useVisitor';
import { buildShareMessage, effectiveStatus, formatCodeValue, formatDateTime, isActive, timeUntil } from '@/features/visitor/utils/visitorFormatters';
import { codeTypeMeta } from '@/features/visitor/constants/visitor.constants';
import * as visitorApi from '@/features/visitor/api/visitor.api';
import { confirmAsync, alertAsync } from '@/lib/confirm';

export default function AccessCodeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: code, isLoading, isError, refetch } = useAccessCode(id ?? '');
  const attendance = useCodeAttendance(id ?? '', { poll: true });
  const revoke = useRevokeAccessCode();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Access code" />
        <StateView kind="loading" message="Loading code…" />
      </SafeAreaView>
    );
  }

  if (isError || !code) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Access code" />
        <StateView
          kind="error"
          icon="QrCode"
          title="Code unavailable"
          message="We couldn't load this access code."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  const meta = codeTypeMeta(code.codeType);
  const status = effectiveStatus(code);
  const active = isActive(code);
  const message = buildShareMessage(code);

  const share = async (channel: 'whatsapp' | 'sms' | 'email') => {
    visitorApi.logShare(code.id);
    const text = encodeURIComponent(message);
    const url =
      channel === 'whatsapp' ? `whatsapp://send?text=${text}`
      : channel === 'sms' ? `sms:${code.visitor.phone ?? ''}${Platform_sep()}body=${text}`
      : `mailto:?subject=${encodeURIComponent(`Access code for ${code.estateName}`)}&body=${text}`;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok && channel === 'whatsapp') {
        alertAsync({ title: 'WhatsApp not installed', message: 'Try sharing via SMS or email instead.' });
        return;
      }
      await Linking.openURL(url);
    } catch {
      alertAsync({ title: 'Could not share', message: 'Please try a different channel.' });
    }
  };

  const copyCode = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const onRevoke = async () => {
    const ok = await confirmAsync({
      title: 'Revoke code?',
      message: 'This code will stop working at the gate immediately.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(code.id, { onError: () => alertAsync({ title: 'Error', message: 'Could not revoke the code.' }) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`${meta.label} code`} rightSlot={<StatusPill status={status} />} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* QR + numeric code */}
        <View style={styles.codeCard}>
          {active ? (
            <QrCodeView payload={code.qrPayload} size={196} />
          ) : (
            <View style={styles.qrDisabled}>
              <Ban size={40} color={Colors.outline} strokeWidth={1.6} />
              <Text style={styles.qrDisabledText}>This code is {status} and cannot be used.</Text>
            </View>
          )}

          <Text style={styles.numericLabel}>Numeric code</Text>
          <Text style={styles.numeric}>{formatCodeValue(code.codeValue)}</Text>
          <Pressable onPress={copyCode} style={styles.copyBtn} accessibilityRole="button" accessibilityLabel="Copy code">
            {copied ? <Check size={15} color={Colors.teal} /> : <Copy size={15} color={Colors.secondary} />}
            <Text style={[styles.copyText, copied && { color: Colors.teal }]}>{copied ? 'Copied' : 'Copy code'}</Text>
          </Pressable>
        </View>

        {/* Live attendance (VM-161/162/163) */}
        {attendance.data ? <AttendanceStatus attendance={attendance.data} usageMode={code.usageMode} /> : null}

        {/* Details */}
        <View style={styles.detailCard}>
          <Row icon={<User size={16} color={Colors.onSurfaceVariant} />} label="Visitor" value={code.visitor.name} />
          <Row icon={<MapPin size={16} color={Colors.onSurfaceVariant} />} label="Host" value={`${code.hostName} · ${code.unitLabel}`} />
          <Row icon={<Users size={16} color={Colors.onSurfaceVariant} />} label="Guests" value={`${code.partySize} ${code.partySize === 1 ? 'guest' : 'guests'}`} />
          <Row icon={<Repeat size={16} color={Colors.onSurfaceVariant} />} label="Usage" value={code.usageMode === 'one_time' ? 'One-time entry' : 'Entry & exit'} />
          {code.recurrenceRule ? <Row icon={<Repeat size={16} color={Colors.onSurfaceVariant} />} label="Schedule" value={code.recurrenceRule} /> : null}
          <Row
            icon={<Clock size={16} color={Colors.onSurfaceVariant} />}
            label="Validity"
            value={active ? `${timeUntil(code.validityEnd)} · until ${formatDateTime(code.validityEnd)}` : formatDateTime(code.validityEnd)}
          />
          {code.visitor.vehiclePlate ? (
            <Row label="Vehicle" value={`${code.visitor.vehiclePlate}${code.visitor.vehicleDesc ? ` · ${code.visitor.vehicleDesc}` : ''}`} />
          ) : null}
          {code.usageMode === 'entry_exit' ? (
            <Row label="Entries" value={`${code.entriesUsed} so far`} />
          ) : null}
        </View>

        {/* Share (VM-121/122) */}
        {active ? (
          <>
            <Text style={styles.shareHeading}>Share access code</Text>
            <View style={styles.shareRow}>
              <ShareButton label="WhatsApp" color={Colors.teal} bg={Colors.iconBgTeal} icon={<MessageCircle size={20} color={Colors.teal} />} onPress={() => share('whatsapp')} />
              <ShareButton label="SMS" color={Colors.secondary} bg={Colors.iconBgBlue} icon={<Share2 size={20} color={Colors.secondary} />} onPress={() => share('sms')} />
              <ShareButton label="Email" color={Colors.primary} bg={Colors.iconBgPurple} icon={<Mail size={20} color={Colors.primary} />} onPress={() => share('email')} />
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Footer actions */}
      <View style={styles.footer}>
        {active ? (
          <View style={styles.footerRow}>
            <PrimaryButton label="Extend" variant="secondary" onPress={() => router.push(`/visitor/extend/${code.id}`)} fullWidth={false} style={styles.footerBtn} />
            <PrimaryButton label="Revoke" variant="ghost" onPress={onRevoke} loading={revoke.isPending} fullWidth={false} style={styles.footerBtn} />
          </View>
        ) : (
          <PrimaryButton label="Create a new code" onPress={() => router.replace('/visitor/create')} />
        )}
      </View>
    </SafeAreaView>
  );
}

// `sms:` query separator differs by platform (`?` iOS, `&`/`?` Android) — keep simple.
function Platform_sep() { return '?'; }

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

function ShareButton({ label, color, bg, icon, onPress }: { label: string; color: string; bg: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Share via ${label}`} style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.8 }]}>
      <View style={[styles.shareIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={[styles.shareLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  codeCard: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
    ...shadow1,
  },
  qrDisabled: { width: 196, height: 196, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  qrDisabledText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  numericLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  numeric: { ...Typography.displayLg, fontSize: 40, lineHeight: 48, color: Colors.onSurface, letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: Spacing.md },
  copyText: { ...Typography.labelMd, color: Colors.secondary },
  detailCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 84 },
  rowLabelText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  shareHeading: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  shareRow: { flexDirection: 'row', gap: Spacing.md },
  shareBtn: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  shareIcon: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  shareLabel: { ...Typography.labelMd },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
  },
  footerRow: { flexDirection: 'row', gap: Spacing.md },
  footerBtn: { flex: 1 },
});

