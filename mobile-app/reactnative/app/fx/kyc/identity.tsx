import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2, Clock, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { kycDraft } from '@/features/fx/utils/kycDraft';
import { fxKycSession } from '@/features/fx/utils/fxKycSession';
import { ID_DOC_TYPES } from '@/features/fx/constants/fx.constants';
import type { IdDocType } from '@/features/fx/types/fx.types';
import { checkIdNumber, createSession, postConsent } from '@/features/kycverify/api';
import { CONSENT_VERSION } from '@/features/kycverify/constants';
import { cleanProviderReason } from '@/features/kycverify/providerReason';
import {
  ID_FORMATS,
  formatIdNumberForDisplay,
  validateIdNumber,
} from '@/features/kycverify/idFormats';
import IdNumberField from '@/features/kycverify/components/IdNumberField';
import DojahRequirement from '@/features/kycverify/components/DojahRequirement';
import type { IdType, VerificationCheck } from '@/features/kycverify/types';

const DOC_LABELS = ID_DOC_TYPES.map((d) => d.label);
const labelToValue = (label: string): IdDocType =>
  (ID_DOC_TYPES.find((d) => d.label === label)?.value as IdDocType) ?? 'nin';
const valueToLabel = (v: IdDocType) => ID_DOC_TYPES.find((d) => d.value === v)?.label ?? DOC_LABELS[0];

// FX document types → the identifier domain the Go KYC gateway + Dojah expect.
const ID_TYPE_BY_DOC: Record<IdDocType, IdType> = {
  nin: 'NIN',
  passport: 'PASSPORT',
  drivers_license: 'DRIVERS_LICENSE',
  voters_card: 'VOTERS_CARD',
};

type Phase = 'editing' | 'verifying' | 'done';

/**
 * Step 3 — identity. The number is verified FOR REAL through the Go
 * /api/finance/kyc gateway: a session is created once per attempt, NDPA consent
 * is recorded (the service fails every check closed without it), and the check
 * is routed to Dojah. The screen states Dojah's input requirement and the exact
 * masked request, and it never asks for a name/DOB — Dojah returns both and the
 * user affirms them.
 */
export default function KycIdentityScreen() {
  const id = kycDraft.current.identity;
  const [docLabel, setDocLabel] = useState(valueToLabel(id.docType));
  const [idNumber, setIdNumber] = useState(id.idNumber);
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>('editing');
  const [check, setCheck] = useState<VerificationCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dob, setDob] = useState(id.dateOfBirth);

  const idType = ID_TYPE_BY_DOC[labelToValue(docLabel)];
  const format = ID_FORMATS[idType];
  const validation = validateIdNumber(idType, idNumber);
  const showError = touched && idNumber.length > 0 ? validation.error : undefined;

  const changeDoc = (label: string) => {
    setDocLabel(label);
    setIdNumber('');
    setTouched(false);
    setCheck(null);
    setError(null);
    setPhase('editing');
  };

  const verify = async () => {
    setTouched(true);
    if (!validation.ok || phase === 'verifying') return;
    setPhase('verifying');
    setError(null);
    try {
      if (!fxKycSession.sessionId) {
        const session = await createSession(1);
        fxKycSession.sessionId = session.id;
      }
      if (!fxKycSession.consentRecorded) {
        await postConsent('kyc-data-processing', CONSENT_VERSION);
        fxKycSession.consentRecorded = true;
      }
      const result = await checkIdNumber({
        sessionId: fxKycSession.sessionId,
        idType,
        idNumber: validation.normalized,
      });
      setCheck(result);
      // Retire a session once its verdict is known: the gateway's state machine
      // refuses a later PASSED check on a session that already failed
      // (TIER_FAILED→TIER_VERIFIED is illegal, HTTP 409), so "Try again" has to
      // open a fresh one. A pending check keeps its session for the webhook.
      if (result.status === 'PASSED' || result.status === 'FAILED') fxKycSession.sessionId = null;
      setPhase('done');
    } catch (err) {
      // A session the gateway has already closed answers 409 to every further
      // check, so drop it here and let the next press open a fresh one.
      if ((err as { response?: { status?: number } })?.response?.status === 409) {
        fxKycSession.sessionId = null;
      }
      setError(verifyErrorMessage(err));
      setPhase('editing');
    }
  };

  const retry = () => {
    setCheck(null);
    setError(null);
    setTouched(false);
    setPhase('editing');
  };

  const status = check?.status;
  // Dojah can answer a PVC lookup with "unsupported id_type" and leave the check
  // PENDING forever. That is a dead end, not a wait, so it blocks like a failure.
  const unsupported = providerCannotCheck(check);
  const blocked = !check || status === 'FAILED' || status === 'INITIATED' || unsupported;
  const neededDob = check && !check.matchedDob ? dob : check?.matchedDob ?? '';
  const canContinue = !blocked && !!neededDob;

  const next = () => {
    if (!check || !canContinue) return;
    kycDraft.current.identity = {
      ...id,
      docType: labelToValue(docLabel),
      idNumber: validation.normalized,
      dateOfBirth: neededDob,
    };
    router.push('/fx/kyc/selfie');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Identity" subtitle="Step 3 of 4" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {phase === 'verifying' ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.centerTitle}>Checking with Dojah…</Text>
            <Text style={styles.centerSub}>
              Matching your {format.label} against government records. This usually takes a few
              seconds.
            </Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {phase === 'done' && check ? (
              <ResultView
                check={check}
                idType={idType}
                idNumber={validation.normalized}
                dob={dob}
                onDob={setDob}
                unsupported={unsupported}
              />
            ) : (
              <>
                <SelectField
                  label="Document type"
                  value={docLabel}
                  options={DOC_LABELS}
                  searchable={false}
                  onChange={changeDoc}
                />
                <IdNumberField
                  idType={idType}
                  value={idNumber}
                  onChangeText={setIdNumber}
                  error={showError}
                />
                <DojahRequirement idType={idType} idNumber={validation.normalized} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </>
            )}
          </ScrollView>
        )}

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {phase === 'verifying' ? null : blocked ? (
            <>
              <PrimaryButton
                label={check ? (unsupported ? 'Choose another document' : 'Try again') : 'Verify with Dojah'}
                onPress={check ? retry : verify}
                disabled={!check && !validation.ok}
              />
              {!check && idNumber.length > 0 && !validation.ok ? (
                <Text style={styles.hint}>
                  Enter the full {format.digits ? `${format.digits}-digit ` : ''}number to continue.
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <PrimaryButton label="Continue" onPress={next} disabled={!canContinue} />
              {!check?.matchedDob && !dob ? (
                <Text style={styles.hint}>Confirm your date of birth to continue.</Text>
              ) : null}
            </>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ResultView({
  check,
  idType,
  idNumber,
  dob,
  onDob,
  unsupported,
}: {
  check: VerificationCheck;
  idType: IdType;
  idNumber: string;
  dob: string;
  onDob: (v: string) => void;
  unsupported: boolean;
}) {
  const format = ID_FORMATS[idType];
  const provider = check.provider === 'dojah' ? 'Dojah' : check.provider ?? 'our verification partner';

  if (check.status === 'FAILED') {
    return (
      <>
        <View style={[styles.statusIcon, styles.statusIconError]}>
          <XCircle size={44} color={Colors.error} strokeWidth={1.8} />
        </View>
        <Text style={styles.statusTitle}>We couldn't match this {format.label}</Text>
        <Text style={styles.statusSub}>
          {cleanProviderReason(check.reason) ?? 'Check the number and try again.'}
        </Text>
        <View style={styles.statusCard}>
          <Row label={format.label} value={formatIdNumberForDisplay(idType, idNumber)} />
          <Row label="Checked by" value={provider} />
        </View>
      </>
    );
  }

  const pending = check.status === 'PENDING' || check.status === 'REVIEW';
  return (
    <>
      <View style={[styles.statusIcon, pending && !unsupported ? styles.statusIconPending : unsupported ? styles.statusIconError : styles.statusIconDone]}>
        {unsupported ? (
          <XCircle size={44} color={Colors.error} strokeWidth={1.8} />
        ) : pending ? (
          <Clock size={44} color={Colors.secondary} strokeWidth={1.8} />
        ) : (
          <CheckCircle2 size={44} color={Colors.tertiaryContainer} strokeWidth={1.8} />
        )}
      </View>
      <Text style={styles.statusTitle}>
        {unsupported
          ? `${provider} can't check this ${format.label}`
          : pending
            ? `${provider} is still checking this ${format.label}`
            : 'Identity matched'}
      </Text>
      <Text style={styles.statusSub}>
        {unsupported
          ? `Pick another document — the number will still be matched against the government register it belongs to.`
          : pending
            ? "We'll finish the check in the background — you can continue and we'll notify you if anything needs attention."
            : `We confirmed your details against the records ${provider} returned.`}
      </Text>

      <View style={styles.statusCard}>
        <Row label={format.label} value={formatIdNumberForDisplay(idType, idNumber)} />
        {check.matchedName ? <Row label="Name" value={check.matchedName} /> : null}
        {check.matchedDob ? <Row label="Date of birth" value={formatDobForDisplay(check.matchedDob)} /> : null}
        <Row label="Checked by" value={provider} />
        {pending && !unsupported ? <Row label="Result" value={check.status === 'REVIEW' ? 'Under review' : 'Pending'} /> : null}
      </View>

      {!check.matchedDob && !unsupported ? (
        <>
          <DatePickerField label="Date of birth" value={dob} onChange={onDob} />
          <Text style={styles.hint}>
            {provider} didn't return a date of birth for this ID, so we need you to confirm it.
          </Text>
        </>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * Dojah answers some lookups with "unsupported id_type" and leaves the check
 * PENDING — the voter's-card route is one. Waiting would never resolve it, so
 * the screen treats it as "this document can't be checked here".
 */
function providerCannotCheck(check: VerificationCheck | null): boolean {
  return !!check && /unsupported\s+id_?type/i.test(check.reason ?? '');
}

/** "1990-01-01" → "1 Jan 1990"; anything unparseable is shown as the provider sent it. */
function formatDobForDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function verifyErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { code?: string; error?: string } }; message?: string };
  const code = e?.response?.data?.code;
  if (code === 'consent_required') {
    return "We couldn't record your consent, so the check didn't run. Please try again.";
  }
  if (code === 'provider_timeout') {
    return 'Dojah and the backup registries took too long to answer. Please try again.';
  }
  if (code === 'no_provider' || e?.response?.status === 503) {
    return 'The verification service is unavailable right now. Please try again shortly.';
  }
  if (code === 'id_type_already_used') {
    return 'You have already verified with this ID type. Choose a different document.';
  }
  if (e?.response?.status === 409) {
    return 'That check was closed by an earlier result, so it was reset. Press "Verify with Dojah" again.';
  }
  const server = e?.response?.data?.error;
  if (typeof server === 'string' && server.trim()) return server;
  return "We couldn't reach the verification service. Please try again.";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  centerTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  centerSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statusIcon: {
    width: 88,
    height: 88,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: Spacing.md,
  },
  statusIconDone: { backgroundColor: Colors.iconBgTeal },
  statusIconPending: { backgroundColor: Colors.surfaceContainer },
  statusIconError: { backgroundColor: Colors.errorContainer },
  statusTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  statusSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
  statusCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rowValue: {
    ...Typography.labelMd,
    color: Colors.onSurface,
    fontWeight: '700' as const,
    flexShrink: 1,
    textAlign: 'right',
  },
  error: { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.md },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
