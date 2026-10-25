// A NATIVE screen: the TMFA programme credential.
//
// Nothing here decides eligibility. The screen renders the server's readiness
// (every topic published, MASTERED at the exact 85% gate, no open holds) and the
// issue button simply asks the server to re-check all of it. While the bundled
// curriculum is still draft, the honest answer is "not eligible yet" — the
// screen says so with the counts rather than promising a certificate.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Award, ShieldCheck, ShieldAlert, CircleCheck, Lock, Copy, Download,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import {
  certificateVerificationUrl,
  downloadCertificatePdf,
  getCertificate,
  requestCertificate,
  FILM_ACADEMY_CERTIFICATE_KEY,
} from '@/features/filmAcademy/api';
import { useMasteryEvents } from '@/features/filmAcademy/useMasteryEvents';
import { getErrorMessage } from '@/utils/errorMapper';
import { HomeMenuButton } from '@/components/HomeMenu';
import type { FilmCertificate, FilmCertificateReadiness } from '@/features/filmAcademy/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function ReadinessCard({ readiness }: { readiness: FilmCertificateReadiness }) {
  const pct = readiness.topicsRequired > 0
    ? Math.round((readiness.topicsMastered * 100) / readiness.topicsRequired)
    : 0;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>What the credential requires</Text>

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {readiness.topicsMastered} of {readiness.topicsRequired} topics mastered
      </Text>

      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text style={styles.kpiValue}>{readiness.topicsPublished}/{readiness.topicsRequired}</Text>
          <Text style={styles.kpiLabel}>topics published</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiValue}>{readiness.openHolds}</Text>
          <Text style={styles.kpiLabel}>open holds</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: readiness.eligible ? Colors.teal : Colors.onSurfaceVariant }]}>
            {readiness.eligible ? 'Eligible' : 'Not yet'}
          </Text>
          <Text style={styles.kpiLabel}>credential</Text>
        </View>
      </View>

      {readiness.blockers.map((b) => (
        <View key={b.code} style={styles.blockerRow}>
          <Lock size={13} color={Colors.onSurfaceVariant} />
          <Text style={styles.blockerText}>{b.message}</Text>
        </View>
      ))}
    </View>
  );
}

function IssuedCard({ certificate }: { certificate: FilmCertificate }) {
  const revoked = !!certificate.revokedAt || certificate.status === 'revoked';
  const [downloading, setDownloading] = useState(false);
  const verifyUrl = certificate.verificationCode
    ? certificateVerificationUrl(certificate.verificationCode)
    : '';

  const copyCode = async () => {
    try {
      await Clipboard.setStringAsync(certificate.verificationCode);
      Alert.alert('Copied', 'Verification code copied to your clipboard.');
    } catch {
      Alert.alert('Could not copy', 'Long-press the code to copy it manually.');
    }
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const { uri } = await downloadCertificatePdf(certificate.certificateNumber);
      if (Platform.OS === 'web') return; // the browser download has already started
      if (!uri) throw new Error('The PDF could not be saved. Please try again.');
      // Lazily required so the web bundle never pulls in the native module.
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Certificate saved', 'The PDF was saved to the app cache on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Save or share your certificate',
      });
    } catch (e) {
      Alert.alert('Download failed', getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <View style={[styles.card, styles.certificateCard, revoked && styles.revokedCard]}>
      <View style={styles.certHead}>
        {revoked
          ? <ShieldAlert size={28} color={Colors.error} />
          : <ShieldCheck size={28} color={Colors.gold} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.certTitle}>
            {revoked ? 'Credential revoked' : 'Verified credential'}
          </Text>
          <Text style={styles.certProgram}>{certificate.programName}</Text>
        </View>
      </View>

      {revoked && !!certificate.revocationReason && (
        <Text style={styles.revokedReason}>Reason: {certificate.revocationReason}</Text>
      )}

      <View style={styles.certMetaGrid}>
        <View style={styles.certMeta}><Text style={styles.certMetaLabel}>Holder</Text>
          <Text style={styles.certMetaValue}>{certificate.studentName}</Text></View>
        <View style={styles.certMeta}><Text style={styles.certMetaLabel}>Certificate no.</Text>
          <Text style={styles.certMetaValue}>{certificate.certificateNumber}</Text></View>
        <View style={styles.certMeta}><Text style={styles.certMetaLabel}>Completed</Text>
          <Text style={styles.certMetaValue}>{formatDate(certificate.completionDate)}</Text></View>
        <View style={styles.certMeta}><Text style={styles.certMetaLabel}>Topics certified</Text>
          <Text style={styles.certMetaValue}>
            {certificate.topicsMastered ?? '—'} of {certificate.topicsRequired ?? '—'}
          </Text></View>
      </View>

      {!revoked && !!verifyUrl && (
        <View style={styles.qrPanel}>
          <View style={styles.qrBox}>
            <QRCode
              value={verifyUrl}
              size={124}
              color={Colors.black}
              backgroundColor={Colors.white}
            />
          </View>
          <View style={styles.qrCopy}>
            <Text style={styles.qrTitle}>Scan to verify</Text>
            <Text style={styles.qrText}>
              Any camera opens the public registry — no account needed. The same QR is
              printed on your PDF.
            </Text>
            <Text style={styles.qrLink} numberOfLines={2}>
              {verifyUrl.replace(/^https?:\/\//, '')}
            </Text>
          </View>
        </View>
      )}

      {!revoked && !!certificate.verificationCode && (
        <Pressable
          onPress={() => { void copyCode(); }}
          style={styles.verifyBox}
          accessibilityRole="button"
          accessibilityLabel="Copy verification code"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.verifyLabel}>Public verification code</Text>
            <Text style={styles.verifyCode}>{certificate.verificationCode}</Text>
          </View>
          <Copy size={16} color={Colors.onSurfaceVariant} />
        </Pressable>
      )}

      {!revoked && !!certificate.verificationCode && (
        <Pressable
          onPress={() => { void download(); }}
          disabled={downloading}
          style={[styles.downloadBtn, downloading && styles.downloadBtnBusy]}
          accessibilityRole="button"
          accessibilityLabel="Download certificate as PDF"
          accessibilityState={{ disabled: downloading, busy: downloading }}
        >
          {downloading
            ? <ActivityIndicator color={Colors.gold} size="small" />
            : <Download size={16} color={Colors.gold} />}
          <Text style={styles.downloadText}>
            {downloading ? 'Preparing your PDF…' : 'Download certificate (PDF)'}
          </Text>
        </Pressable>
      )}
      <Text style={styles.certFoot}>
        {revoked
          ? 'A revoked credential stays verifiable so an employer sees the revocation rather than a missing record.'
          : 'Share this code with an employer or festival. Verification returns your name, programme, completion date and status — never your email or phone.'}
      </Text>
    </View>
  );
}

export default function FilmAcademyCertificateScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_CERTIFICATE_KEY,
    queryFn: getCertificate,
  });

  useMasteryEvents(!!data);

  const issue = useMutation({
    mutationFn: requestCertificate,
    onSuccess: (result) => {
      queryClient.setQueryData(FILM_ACADEMY_CERTIFICATE_KEY, {
        readiness: result.readiness,
        certificate: result.certificate,
      });
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_CERTIFICATE_KEY });
      Alert.alert(
        result.created ? 'Credential issued' : 'Already issued',
        result.certificate
          ? `Certificate ${result.certificate.certificateNumber} is now in your academy record.`
          : 'Your credential is already on file.',
      );
    },
    onError: (e) => Alert.alert('Certificate not issued', getErrorMessage(e)),
  });

  const certificate = data?.certificate ?? null;
  const readiness = data?.readiness;
  const active = !!certificate && certificate.status === 'issued' && !certificate.revokedAt;
  const revoked = !!certificate && (!!certificate.revokedAt || certificate.status === 'revoked');
  // A revoked credential is replaced by an academy administrator only. The
  // server refuses a learner self-issue with 409, so the button must not fire.
  const canRequestIssue = !!readiness?.eligible && !active && !revoked;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Certificate</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Checking your credential…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your certificate.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && (
          <>
            {certificate ? <IssuedCard certificate={certificate} /> : null}
            {readiness ? <ReadinessCard readiness={readiness} /> : null}

            <Pressable
              onPress={() => issue.mutate()}
              disabled={!canRequestIssue || issue.isPending}
              style={[styles.issueBtn, (!canRequestIssue || issue.isPending) && styles.issueBtnDisabled]}
            >
              {issue.isPending
                ? <ActivityIndicator color={Colors.black} />
                : (
                  <>
                    <Award size={18} color={Colors.black} />
                    <Text style={styles.issueText}>
                      {active ? 'Credential already issued' : revoked ? 'Ask your academy to reissue' : 'Issue my certificate'}
                    </Text>
                  </>
                )}
            </Pressable>

            {revoked && (
              <Text style={styles.helper}>
                This credential was revoked. Only an academy administrator can issue a
                replacement, so contact your academy — this page cannot reissue it.
              </Text>
            )}

            {!revoked && !canRequestIssue && !active && (
              <Text style={styles.helper}>
                The issue button unlocks only when the server reports every topic published and
                mastered at 85% or higher, with no open hold. Until then this page shows exactly
                what remains.
              </Text>
            )}

            <Pressable onPress={() => router.push('/film-academy/path' as never)} style={styles.pathLink}>
              <CircleCheck size={15} color={Colors.teal} />
              <Text style={styles.pathLinkText}>Open your topic path</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
                 gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  bar:         { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceVariant,
                 overflow: 'hidden', marginTop: Spacing.xs },
  barFill:     { height: 8, borderRadius: 4, backgroundColor: Colors.teal },
  progressText:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  kpiRow:      { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  kpi:         { flex: 1, gap: 2 },
  kpiValue:    { ...Typography.titleMd, color: Colors.onSurface },
  kpiLabel:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  blockerRow:  { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: Spacing.xs },
  blockerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },

  certificateCard: { borderWidth: 1, borderColor: Colors.gold },
  revokedCard:     { borderColor: Colors.error },
  certHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  certTitle:   { ...Typography.titleLg, color: Colors.onSurface },
  certProgram: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  revokedReason:{ ...Typography.labelSm, color: Colors.error },
  certMetaGrid:{ flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.sm, rowGap: Spacing.md },
  certMeta:    { width: '50%', gap: 2 },
  certMetaLabel:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  certMetaValue:{ ...Typography.bodyMd, color: Colors.onSurface },
  verifyBox:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surfaceVariant, borderRadius: Radius.md,
                 padding: Spacing.md, marginTop: Spacing.xs },
  verifyLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  verifyCode:  { ...Typography.titleMd, color: Colors.onSurface, letterSpacing: 1.5 },
  qrPanel:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                 marginTop: Spacing.sm },
  qrBox:       { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.sm },
  qrCopy:      { flex: 1, gap: 2 },
  qrTitle:     { ...Typography.titleMd, color: Colors.onSurface },
  qrText:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  qrLink:      { ...Typography.labelSm, color: Colors.teal, marginTop: 2 },
  downloadBtn: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center',
                 borderWidth: 1, borderColor: Colors.gold, borderRadius: Radius.md,
                 paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  downloadBtnBusy: { opacity: 0.6 },
  downloadText:{ ...Typography.labelLg, color: Colors.gold },
  certFoot:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },

  issueBtn:    { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md },
  issueBtnDisabled:{ opacity: 0.45 },
  issueText:   { ...Typography.labelLg, color: Colors.black },
  helper:      { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  pathLink:    { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center',
                 paddingVertical: Spacing.md },
  pathLinkText:{ ...Typography.labelLg, color: Colors.teal },
});
