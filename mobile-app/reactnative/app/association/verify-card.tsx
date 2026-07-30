import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScanLine, Camera, CheckCircle2, XCircle, RotateCcw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useMembershipCard, useVerifyCard } from '@/features/association/hooks/useAssociation';
import type { CardVerification } from '@/features/association/types/association.types';

// Human-readable copy for each verification failure reason.
const REASON_COPY: Record<string, string> = {
  INVALID_SIGNATURE: 'Invalid or forged QR — this card could not be verified.',
  NOT_FOUND: 'No matching member record was found.',
  SUSPENDED: 'This membership has been suspended.',
  EXPIRED: 'This card has expired.',
  REVOKED: 'This membership is no longer active.',
  ARREARS: 'Dues are in arrears — the card is not in good standing.',
};

export default function VerifyCardScreen() {
  const card = useMembershipCard();
  const verify = useVerifyCard();
  const [manual, setManual] = useState('');

  const result = verify.data as CardVerification | undefined;

  const run = (token: string) => {
    const t = (token ?? '').trim();
    if (!t) return;
    verify.mutate(t);
  };

  const reset = () => {
    verify.reset();
    setManual('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify membership card" />

      {result ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ResultCard result={result} />
          <PrimaryButton label="Verify another card" variant="secondary" onPress={reset} />
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
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
            <Text style={styles.hint}>Point the camera at the member's card QR code.</Text>
          </View>

          <PrimaryButton
            label="Simulate scan"
            onPress={() => run(card.data?.qrPayload ?? '')}
            loading={verify.isPending}
            disabled={!card.data?.qrPayload}
          />

          {/* Manual entry fallback */}
          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>or enter the code</Text>
            <View style={styles.line} />
          </View>
          <TextInput
            value={manual}
            onChangeText={setManual}
            placeholder="Paste card verification code"
            placeholderTextColor={Colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Card verification code"
          />
          <PrimaryButton
            label="Verify code"
            variant="secondary"
            onPress={() => run(manual)}
            loading={verify.isPending}
            disabled={!manual.trim()}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ResultCard({ result }: { result: CardVerification }) {
  const valid = result.valid;
  const accent = valid ? Colors.onTertiaryContainer : Colors.error;
  const tint = valid ? Colors.surfaceContainerLow : Colors.errorContainer;

  return (
    <View>
      <View style={[styles.badge, { backgroundColor: tint, borderColor: accent }]}>
        {valid ? (
          <CheckCircle2 size={44} color={accent} strokeWidth={2} />
        ) : (
          <XCircle size={44} color={accent} strokeWidth={2} />
        )}
        <Text style={[styles.badgeTitle, { color: accent }]}>
          {valid ? 'Valid membership' : 'Not verified'}
        </Text>
        {!valid && (
          <Text style={styles.badgeReason}>
            {REASON_COPY[result.reason ?? ''] ?? 'This card could not be verified.'}
          </Text>
        )}
      </View>

      {(result.fullName || result.memberId) && (
        <View style={styles.facia}>
          {!!result.fullName && <Row label="Member" value={result.fullName} />}
          {!!result.memberId && <Row label="Member ID" value={result.memberId} />}
          {!!result.organisationName && (
            <Row
              label="Organisation"
              value={
                result.organisationAcronym
                  ? `${result.organisationName} (${result.organisationAcronym})`
                  : result.organisationName
              }
            />
          )}
          {!!result.categoryLabel && <Row label="Tier" value={result.categoryLabel} />}
          {!!result.status && <Row label="Status" value={result.status} />}
          {!!result.paymentStanding && <Row label="Standing" value={result.paymentStanding} />}
          {!!result.validThrough && <Row label="Valid thru" value={String(result.validThrough).slice(0, 10)} />}
        </View>
      )}

      <View style={styles.metaRow}>
        <RotateCcw size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.metaText}>
          Checked {new Date(result.verifiedAt).toLocaleTimeString()} · verified live against the register.
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, paddingTop: Spacing.md, gap: Spacing.md },
  viewfinder: {
    alignSelf: 'center', width: 220, height: 220, marginTop: Spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: Colors.primary },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: Radius.md },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radius.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: Radius.md },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: Radius.md },
  scanIcon: { opacity: 0.9 },
  cameraHint: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center', justifyContent: 'center' },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  line: { flex: 1, height: 1, backgroundColor: Colors.outlineVariant },
  dividerText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  input: {
    ...Typography.bodyMd, color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  badge: {
    alignItems: 'center', gap: Spacing.xs, padding: Spacing.lg,
    borderRadius: Radius.xl, borderWidth: 1.5,
  },
  badgeTitle: { ...Typography.titleLg },
  badgeReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  facia: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  metaRow: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center', justifyContent: 'center' },
  metaText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
