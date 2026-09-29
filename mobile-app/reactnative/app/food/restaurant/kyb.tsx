import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedControl from '@/components/SegmentedControl';
import BankPicker from '@/features/transfers/components/BankPicker';
import { alertAsync } from '@/lib/confirm';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useMyStores, useKYB, useSaveKYB, useAddKYBDocument, useSubmitKYB } from '@/features/restaurantmerchant/hooks';
import { resolveActiveOutlet } from '@/features/restaurantmerchant/activeOutlet';
import { useBanks, useResolveAccount } from '@/features/transfers/hooks';
import type { KYBBusinessType } from '@/features/restaurantmerchant/types';

const BUSINESS_TYPES: { value: KYBBusinessType; label: string }[] = [
  { value: 'sole_proprietor', label: 'Sole proprietor' },
  { value: 'limited_company', label: 'Limited company' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'ngo', label: 'NGO' },
];

// draft/needs_more_info/rejected can be edited; submitted/under_review/approved are
// locked until a reviewer acts — mirrors backend editableKYB (kyb_service.go).
const EDITABLE_STATUSES = new Set(['draft', 'needs_more_info', 'rejected']);

const STATUS_COPY: Record<string, { title: string; message: string }> = {
  submitted: {
    title: 'Submitted — awaiting review',
    message: "We've received your business verification. This usually takes a few days — no action needed, we'll notify you once it's reviewed.",
  },
  under_review: {
    title: 'Under review',
    message: "A reviewer is looking at your business verification. This usually takes a few days — no action needed, we'll notify you as soon as it's decided.",
  },
  approved: {
    title: 'Approved',
    message: 'Your business is verified. You can open for orders any time.',
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business verification" />
      {children}
    </SafeAreaView>
  );
}

export default function KYBScreen() {
  const { outlet } = useLocalSearchParams<{ outlet?: string }>();
  const stores = useMyStores();
  const { active } = resolveActiveOutlet(stores.data, typeof outlet === 'string' ? outlet : null);
  const storeId = active?.id ?? '';

  const kyb = useKYB(storeId);
  const save = useSaveKYB(storeId);
  const addDoc = useAddKYBDocument(storeId);
  const submit = useSubmitKYB(storeId);
  const banks = useBanks();
  const resolveAccountMut = useResolveAccount();

  const bankOptions = useMemo(
    () => (banks.data ?? []).map((b) => ({ label: b.name, value: b.code })),
    [banks.data],
  );

  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState<KYBBusinessType>('sole_proprietor');
  const [rcNumber, setRcNumber] = useState('');
  const [tin, setTin] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [certUrl, setCertUrl] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Seed local form state from the server once, when it first arrives — after that
  // the form is the source of truth until the next successful save (same pattern as
  // ManageStore's profile fields: a server refetch mid-edit must not clobber typing).
  useEffect(() => {
    if (loaded || !kyb.data) return;
    setLegalName(kyb.data.legalName);
    if (kyb.data.businessType) setBusinessType(kyb.data.businessType);
    setRcNumber(kyb.data.rcNumber);
    setTin(kyb.data.tin);
    setContactEmail(kyb.data.contactEmail);
    setContactPhone(kyb.data.contactPhone);
    setBankCode(kyb.data.bankCode);
    setAccountNumber(kyb.data.accountNumber);
    setAccountName(kyb.data.accountName);
    setLoaded(true);
  }, [kyb.data, loaded]);

  // Auto-resolve the account name on a 10-digit NUBAN, same debounced pattern as
  // TransferScreen — the owner shouldn't have to type their own settlement account's
  // registered name by hand when the bank can confirm it.
  useEffect(() => {
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return;
    const handle = setTimeout(() => {
      resolveAccountMut.mutate(
        { bankCode, accountNumber },
        { onSuccess: (r) => setAccountName(r.accountName) },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, accountNumber]);

  const needsRegistration = businessType !== 'sole_proprietor';
  const hasCertDoc = (kyb.data?.documents ?? []).includes('cac_certificate');

  const missing: string[] = [];
  if (!legalName.trim()) missing.push('legal name');
  if (!contactPhone.trim()) missing.push('contact phone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) missing.push('a valid contact email');
  if (!bankCode) missing.push('settlement bank');
  if (!/^\d{10}$/.test(accountNumber)) missing.push('a 10-digit account number');
  if (!accountName.trim()) missing.push('account name');
  if (needsRegistration && !rcNumber.trim()) missing.push('CAC RC/BN number');
  if (needsRegistration && !hasCertDoc) missing.push('CAC certificate document');
  const readyToSubmit = missing.length === 0;

  const saveForm = (onSuccess?: () => void) => {
    save.mutate(
      { legalName: legalName.trim(), businessType, rcNumber: rcNumber.trim(), tin: tin.trim(),
        contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(),
        bankCode, accountNumber, accountName: accountName.trim() },
      {
        onSuccess,
        onError: (e) => alertAsync({ title: "Couldn't save", message: (e as Error)?.message ?? 'Please try again.' }),
      },
    );
  };

  const attachCert = () => {
    if (!certUrl.trim()) return;
    addDoc.mutate(
      { docType: 'cac_certificate', fileUrl: certUrl.trim() },
      {
        onSuccess: () => setCertUrl(''),
        onError: (e) => alertAsync({ title: "Couldn't attach document", message: (e as Error)?.message ?? 'Please try again.' }),
      },
    );
  };

  const doSubmit = () => {
    if (!readyToSubmit) {
      alertAsync({ title: 'A few things are missing', message: `Still needed: ${missing.join(', ')}.` });
      return;
    }
    // Save whatever's currently typed first, so submit reviews the latest details —
    // then submit. Matches backend SubmitKYB, which reviews the row as saved.
    saveForm(() =>
      submit.mutate(undefined, {
        onSuccess: () => router.back(),
        onError: (e) => alertAsync({ title: "Couldn't submit", message: (e as Error)?.message ?? 'Please try again.' }),
      }),
    );
  };

  if (stores.isLoading || (kyb.isLoading && !loaded)) {
    return <Shell><StateView kind="loading" title="Loading" /></Shell>;
  }
  if (!active) {
    return (
      <Shell>
        <StateView kind="empty" icon="Store" title="No outlet yet"
          message="Create a restaurant before submitting business verification." />
      </Shell>
    );
  }
  if (kyb.isError) {
    return (
      <Shell>
        <StateView kind="error" title="Couldn't load verification status"
          actionLabel="Retry" onAction={() => kyb.refetch()} />
      </Shell>
    );
  }

  const status = kyb.data?.status ?? 'draft';
  const editable = EDITABLE_STATUSES.has(status);
  const readOnlyCopy = STATUS_COPY[status];

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.outlet}>{active.name}</Text>
        <View style={styles.introRow}>
          <ShieldCheck size={18} color={Colors.primary} />
          <Text style={styles.muted}>
            Opening for orders requires an approved business verification. Closing is always allowed.
          </Text>
        </View>

        {readOnlyCopy && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>{readOnlyCopy.title}</Text>
            <Text style={styles.muted}>{readOnlyCopy.message}</Text>
          </View>
        )}
        {status === 'needs_more_info' && (
          <View style={[styles.statusCard, styles.statusWarn]}>
            <Text style={[styles.statusTitle, { color: Colors.error }]}>More information needed</Text>
            <Text style={styles.muted}>
              {kyb.data?.decisionReason || 'A reviewer asked for more detail. Update the fields below and resubmit.'}
            </Text>
          </View>
        )}
        {status === 'rejected' && (
          <View style={[styles.statusCard, styles.statusWarn]}>
            <Text style={[styles.statusTitle, { color: Colors.error }]}>Verification declined</Text>
            <Text style={styles.muted}>
              {kyb.data?.decisionReason || 'Your verification was declined. Update the fields below and reapply.'}
            </Text>
          </View>
        )}

        {editable && (
          <>
            <Card title="Business details">
              <TextInputField label="Legal business name" value={legalName} onChangeText={setLegalName} placeholder="Blue Yam Kitchens Ltd" />
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Business type</Text>
                <SegmentedControl options={BUSINESS_TYPES} value={businessType} onChange={setBusinessType} scrollable />
              </View>
              {needsRegistration && (
                <TextInputField label="CAC RC/BN number" value={rcNumber} onChangeText={setRcNumber} placeholder="RC1234567" autoCapitalize="characters" />
              )}
              <TextInputField label="Tax ID (TIN, optional)" value={tin} onChangeText={setTin} placeholder="12345678-0001" />
              <TextInputField label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="owner@yourbusiness.com" keyboardType="email-address" autoCapitalize="none" />
              <TextInputField label="Contact phone" value={contactPhone} onChangeText={setContactPhone} placeholder="0803 000 0000" keyboardType="phone-pad" />
            </Card>

            {needsRegistration && (
              <Card title="CAC certificate">
                <Text style={styles.muted}>
                  {hasCertDoc
                    ? 'Certificate on file. Paste a new link below to replace it.'
                    : 'Required for a registered business. Paste a link to your hosted certificate (e.g. a Drive or Dropbox share link).'}
                </Text>
                <TextInputField label="Certificate URL" value={certUrl} onChangeText={setCertUrl} placeholder="https://…" autoCapitalize="none" />
                <PrimaryButton label="Attach document" variant="secondary" onPress={attachCert} loading={addDoc.isPending} disabled={!certUrl.trim()} />
              </Card>
            )}

            <Card title="Settlement account">
              <Text style={styles.muted}>The bank account your payouts are settled to once approved.</Text>
              <BankPicker label="Bank" value={bankCode} options={bankOptions} onChange={setBankCode} loading={banks.isLoading} />
              <TextInputField label="Account number" value={accountNumber} onChangeText={(t) => setAccountNumber(t.replace(/\D/g, '').slice(0, 10))} placeholder="0123456789" keyboardType="number-pad" />
              <TextInputField
                label="Account name"
                value={accountName}
                onChangeText={setAccountName}
                placeholder={resolveAccountMut.isPending ? 'Resolving…' : 'Auto-fills from bank + account number'}
                editable={!resolveAccountMut.isPending}
              />
            </Card>

            <PrimaryButton label="Save" variant="secondary" onPress={() => saveForm()} loading={save.isPending} />
            <PrimaryButton label="Submit for review" onPress={doSubmit} loading={submit.isPending || save.isPending} />
            {!readyToSubmit && (
              <Text style={styles.missingText}>Still needed: {missing.join(', ')}.</Text>
            )}
          </>
        )}
      </ScrollView>
    </Shell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  outlet: { color: Colors.onSurface, fontSize: 18, fontWeight: '700' },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardTitle: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  statusCard: {
    gap: 4, padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  statusWarn: { borderColor: Colors.error },
  statusTitle: { color: Colors.onSurface, fontSize: 14, fontWeight: '700' },
  missingText: { color: Colors.error, fontSize: 12, textAlign: 'center' },
});
