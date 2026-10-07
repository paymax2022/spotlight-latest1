import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Info, CheckCircle2, Clock, XCircle, Ban, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import {
  useMyRoleProfiles,
  useUpdateRoleProfile,
  useSubmitRoleForVerification,
  useUploadRoleDocument,
} from '@/features/property/roles/hooks';
import {
  PROFESSIONAL_ROLES,
  missingRequired,
  requiredFieldsFor,
  optionalFieldsFor,
  type ProfessionalRole,
} from '@/features/property/roles/requirements';
import { RoleUploadsUnavailableError, RoleDocumentTypeError } from '@/features/property/roles/api';
import type { RoleDocumentKind } from '@/features/property/roles/types';

type FieldKind = 'text' | 'multiline' | 'list' | 'number';
const FIELDS: Record<string, { label: string; kind: FieldKind; hint?: string }> = {
  licenceNumber: { label: 'Licence number', kind: 'text' },
  operatingStates: { label: 'Operating states', kind: 'list', hint: 'Comma-separated, e.g. Lagos, Abuja' },
  agencyName: { label: 'Agency name', kind: 'text' },
  bio: { label: 'Bio', kind: 'multiline' },
  specialisations: { label: 'Specialisations', kind: 'list', hint: 'Comma-separated' },
  companyName: { label: 'Company name', kind: 'text' },
  cacNumber: { label: 'CAC number', kind: 'text' },
  website: { label: 'Website', kind: 'text' },
  projectSummary: { label: 'Project summary', kind: 'multiline' },
  organisationName: { label: 'Organisation name', kind: 'text' },
  estatesManaged: { label: 'Estates managed', kind: 'number', hint: 'Whole number' },
};

const ROLE_LABEL: Record<ProfessionalRole, string> = {
  estate_manager: 'Estate Manager',
  developer: 'Property Developer',
  agent: 'Property Agent / Marketer',
};

const DOC_KINDS: { kind: RoleDocumentKind; label: string }[] = [
  { kind: 'agent_licence', label: 'Agent licence' },
  { kind: 'cac_certificate', label: 'CAC certificate' },
  { kind: 'authority_letter', label: 'Authority letter' },
  { kind: 'id_document', label: 'ID document' },
];
const DEFAULT_DOC_KIND: Record<ProfessionalRole, RoleDocumentKind> = {
  agent: 'agent_licence', developer: 'cac_certificate', estate_manager: 'authority_letter',
};

// Fields whose edit on a verified/pending profile resets verification server-side.
const identityKeys = (role: ProfessionalRole) => ['displayName', ...requiredFieldsFor(role)];

function toForm(details: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = details[k];
    out[k] = Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
  }
  return out;
}

function toDetails(form: Record<string, string>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const raw = (form[k] ?? '').trim();
    const kind = FIELDS[k]?.kind;
    if (kind === 'list') out[k] = raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : [];
    else if (kind === 'number') {
      if (raw !== '' && /^\d+$/.test(raw)) out[k] = Number(raw);
    } else if (raw !== '') out[k] = raw;
  }
  return out;
}

export default function RoleProfileScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role = (PROFESSIONAL_ROLES as string[]).includes(params.role ?? '')
    ? (params.role as ProfessionalRole)
    : 'agent';

  const { data: profiles, isLoading } = useMyRoleProfiles();
  const profile = profiles?.find((p) => p.role === role);
  const update = useUpdateRoleProfile(role);
  const submit = useSubmitRoleForVerification(role);
  const upload = useUploadRoleDocument(role);

  const keys = useMemo(() => [...requiredFieldsFor(role), ...optionalFieldsFor(role)], [role]);
  const [displayName, setDisplayName] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [docKind, setDocKind] = useState<RoleDocumentKind>(DEFAULT_DOC_KIND[role]);
  const [uploadsOff, setUploadsOff] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (profile && !hydrated) {
      setDisplayName(profile.displayName);
      setForm(toForm(profile.details ?? {}, keys));
      setHydrated(true);
    }
  }, [profile, hydrated, keys]);

  const details = useMemo(() => toDetails(form, keys), [form, keys]);
  const missing = missingRequired(role, details);
  const docCount = profile?.documents.length ?? 0;
  const suspended = profile?.status === 'suspended';
  const vs = profile?.verificationStatus;
  const locked = suspended || vs === 'pending' || vs === 'verified';
  const canSubmit = !!profile && missing.length === 0 && displayName.trim() !== '' && docCount > 0 && !locked;

  const dirty = useMemo(() => {
    if (!profile) return false;
    if (displayName.trim() !== profile.displayName) return true;
    return JSON.stringify(details) !== JSON.stringify(toDetails(toForm(profile.details ?? {}, keys), keys));
  }, [profile, displayName, details, keys]);

  const identityChanged = useMemo(() => {
    if (!profile) return false;
    const saved = toDetails(toForm(profile.details ?? {}, keys), keys);
    if (displayName.trim() !== profile.displayName) return true;
    return requiredFieldsFor(role).some((k) => JSON.stringify(saved[k]) !== JSON.stringify(details[k]));
  }, [profile, displayName, details, keys, role]);

  const save = async (): Promise<boolean> => {
    if (!profile || suspended) return false;
    if (identityChanged && (vs === 'verified' || vs === 'pending')) {
      const ok = await confirmAsync({
        title: 'Changing identity details',
        message: 'Editing your name or identity fields resets verification. You will need to submit again for review.',
        confirmLabel: 'Save and reset',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return false;
    }
    try {
      await update.mutateAsync({ displayName: displayName.trim(), details });
      return true;
    } catch {
      await alertAsync({ title: 'Could not save', message: 'Check your details and try again.' });
      return false;
    }
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    if (dirty && !(await save())) return;
    try {
      await submit.mutateAsync();
      await alertAsync({ title: 'Submitted', message: 'Your details are with our review team.' });
    } catch {
      await alertAsync({ title: 'Could not submit', message: 'Make sure required fields and a document are in place, then try again.' });
    }
  };

  const onPickDocument = async () => {
    if (!profile || suspended || upload.isPending) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const f = res.assets[0];
      await upload.mutateAsync({ kind: docKind, localUri: f.uri, fileName: f.name, mimeType: f.mimeType });
    } catch (err) {
      if (err instanceof RoleUploadsUnavailableError) {
        setUploadsOff(true);
      } else if (err instanceof RoleDocumentTypeError) {
        await alertAsync({ title: 'Unsupported file', message: err.message });
      } else {
        await alertAsync({ title: 'Upload failed', message: 'The document could not be uploaded. Please try again.' });
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title={ROLE_LABEL[role]} subtitle="Professional registration" />
      {isLoading || !profile ? (
        <View style={styles.center}>
          {isLoading ? <ActivityIndicator color={Colors.teal} /> : (
            <Text style={styles.muted}>No registration found for this role. Go back and choose it again.</Text>
          )}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <StatusBanner status={profile.status} vs={profile.verificationStatus} reason={profile.rejectionReason} />

            <SectionHeader title="Details" style={styles.section} />
            <TextInputField label="Display name *" value={displayName} onChangeText={setDisplayName} editable={!suspended} />
            {keys.map((k) => {
              const f = FIELDS[k];
              const required = requiredFieldsFor(role).includes(k);
              return (
                <View key={k}>
                  <TextInputField
                    label={`${f.label}${required ? ' *' : ''}`}
                    value={form[k] ?? ''}
                    onChangeText={(t) => setForm((s) => ({ ...s, [k]: t }))}
                    editable={!suspended}
                    multiline={f.kind === 'multiline'}
                    keyboardType={f.kind === 'number' ? 'number-pad' : 'default'}
                    autoCapitalize={k === 'website' ? 'none' : 'sentences'}
                  />
                  {f.hint ? <Text style={styles.hint}>{f.hint}</Text> : null}
                </View>
              );
            })}
            <PrimaryButton
              label="Save details"
              variant="secondary"
              onPress={save}
              loading={update.isPending}
              disabled={!dirty || suspended}
            />

            <SectionHeader title="Verification documents" style={styles.section} />
            <View style={styles.chips}>
              {DOC_KINDS.map((d) => (
                <Pressable
                  key={d.kind}
                  onPress={() => setDocKind(d.kind)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: docKind === d.kind }}
                  style={[styles.chip, docKind === d.kind && styles.chipSel]}
                >
                  <Text style={[styles.chipText, docKind === d.kind && styles.chipTextSel]}>{d.label}</Text>
                </Pressable>
              ))}
            </View>
            {uploadsOff ? (
              <View style={styles.notice}>
                <Info size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.noticeText}>
                  Document uploads are not available right now. This is a server setting, so retrying will not help — please contact support.
                </Text>
              </View>
            ) : null}
            <PrimaryButton
              label="Choose file (PNG, JPEG, WebP or PDF)"
              variant="secondary"
              onPress={onPickDocument}
              loading={upload.isPending}
              disabled={suspended || uploadsOff}
            />
            {profile.documents.map((d) => (
              <View key={d.id} style={styles.docRow}>
                <FileText size={18} color={Colors.teal} strokeWidth={1.8} />
                <Text style={styles.docText}>{DOC_KINDS.find((x) => x.kind === d.kind)?.label ?? d.kind}</Text>
              </View>
            ))}
            {docCount === 0 ? <Text style={styles.hint}>At least one document is required to submit.</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            {missing.length > 0 ? (
              <Text style={styles.hint}>Still needed: {missing.map((k) => FIELDS[k]?.label ?? k).join(', ')}</Text>
            ) : null}
            <PrimaryButton
              label={vs === 'rejected' ? 'Resubmit for verification' : 'Submit for verification'}
              onPress={onSubmit}
              loading={submit.isPending}
              disabled={!canSubmit}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function StatusBanner({ status, vs, reason }: { status: string; vs: string; reason?: string | null }) {
  let Icon = Info;
  let title = 'Not yet submitted';
  let body = 'Complete the details and add a document, then submit for verification.';
  if (status === 'suspended') {
    Icon = Ban; title = 'Suspended'; body = 'This role is suspended. Editing and submitting are disabled.';
  } else if (vs === 'pending') {
    Icon = Clock; title = 'Pending review'; body = 'Our team is reviewing your submission.';
  } else if (vs === 'verified') {
    Icon = CheckCircle2; title = 'Verified'; body = 'Your role is verified. Editing identity fields will reset verification.';
  } else if (vs === 'rejected') {
    Icon = XCircle; title = 'Rejected';
    body = reason ? `Reason: ${reason}` : 'Your submission was rejected. Update your details and resubmit.';
  }
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Icon size={20} color={Colors.teal} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>{title}</Text>
        <Text style={styles.bannerBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.containerMargin },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  banner: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  bannerTitle: { ...Typography.labelLg, color: Colors.onSurface },
  bannerBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  chipSel: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextSel: { color: Colors.onSurface },
  notice: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  noticeText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  docText: { ...Typography.bodySm, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.xs },
});
