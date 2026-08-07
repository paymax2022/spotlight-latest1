import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Send,
  User,
  BadgeCheck,
  Building2,
  ShieldCheck,
  Info,
  ChevronRight,
  Banknote,
} from 'lucide-react-native';

import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

import {
  resolvePaymaxRecipient,
  initiateWalletTransfer,
  calculateTransferFee,
} from '@/api/transfers.api';
import { fetchBeneficiaries } from '@/api/beneficiaries.api';
import { getWallet } from '@/api/wallet.api';
import type { TransferRecipient, WalletTransfer, Beneficiary } from '@/types/wallet';

import { formatNaira, nairaStringToKobo } from '@/utils/money';
import { getErrorMessage } from '@/utils/errorMapper';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { shadow1, shadow2 } from '@/constants/shadows';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';

import BankPicker from './components/BankPicker';
import AmountInput from './components/AmountInput';
import PinSheet from './components/PinSheet';
import TransferReceipt from './components/TransferReceipt';
import {
  useBanks,
  usePinStatus,
  useResolveAccount,
  useCreatePin,
  useWalletToBankTransfer,
  useBankToBankTransfer,
} from './hooks';
import { walletBankFee, bankToBankFee } from './api';
import type { TransferType, ResolvedAccount, TransferReceiptData } from './types';

const SEGMENTS: { value: TransferType; label: string }[] = [
  { value: 'wallet_wallet', label: 'Paymax' },
  { value: 'wallet_bank', label: 'To Bank' },
  { value: 'bank_bank', label: 'Bank → Bank' },
];

type Step = 'form' | 'review' | 'success';

// Minimum transferable amount (kobo) — ₦1.
const MIN_TRANSFER_KOBO = 100;

interface BankAccountState {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  resolved: ResolvedAccount | null;
}

const emptyAccount: BankAccountState = { bankCode: '', bankName: '', accountNumber: '', resolved: null };

export default function TransferScreen() {
  const [type, setType] = useState<TransferType>('wallet_wallet');
  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [saveBeneficiary, setSaveBeneficiary] = useState(false);

  // wallet → wallet
  const [recipient, setRecipient] = useState('');
  const [resolvedRecipient, setResolvedRecipient] = useState<TransferRecipient | null>(null);

  // bank flows
  const [dest, setDest] = useState<BankAccountState>(emptyAccount);
  const [source, setSource] = useState<BankAccountState>(emptyAccount); // bank → bank only

  // PIN gate
  const [pinSheet, setPinSheet] = useState<null | 'create' | 'verify'>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  // receipt
  const [receipt, setReceipt] = useState<TransferReceiptData | null>(null);

  const amountKobo = useMemo(() => nairaStringToKobo(amount), [amount]);

  const banksQuery = useBanks();
  const pinStatusQuery = usePinStatus();
  const walletQuery = useQuery({ queryKey: ['wallet', 'balance'], queryFn: getWallet, staleTime: 30_000 });
  const beneficiariesQuery = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: fetchBeneficiaries,
    staleTime: 60_000,
  });

  const bankOptions = useMemo(
    () => (banksQuery.data ?? []).map((b) => ({ label: b.name, value: b.code })),
    [banksQuery.data],
  );

  const resolveAccountMut = useResolveAccount();
  const createPinMut = useCreatePin();
  const walletBankMut = useWalletToBankTransfer();
  const bankBankMut = useBankToBankTransfer();

  // ── fee per type ────────────────────────────────────────────────────────────
  const feeKobo = useMemo(() => {
    if (type === 'wallet_wallet') return calculateTransferFee(amountKobo);
    if (type === 'wallet_bank') return walletBankFee(amountKobo);
    return bankToBankFee(amountKobo);
  }, [type, amountKobo]);

  const balanceKobo = (walletQuery.data?.balance ?? 0) * 100; // wallet.balance is naira major units

  // ── pre-flight validation: wallet balance sufficiency ───────────────────────
  // The NGN wallet is active on account creation, so there is NO KYC/tier gate on a
  // basic send. The single hard rule: (amount + fee) must not exceed the wallet
  // balance. Applies to the wallet-funded flows (wallet→wallet, wallet→bank);
  // bank→bank funds from an external source account and is exempt. The backend stays
  // authoritative (ledger insufficient-funds → 402); this blocks it earlier + clearer.
  const totalDebitKobo = amountKobo + feeKobo;
  const usesWallet = type === 'wallet_wallet' || type === 'wallet_bank';
  const walletGuard = useMemo(() => {
    if (!usesWallet || amountKobo < MIN_TRANSFER_KOBO) return { blocked: false, reason: null as string | null };
    if (walletQuery.isSuccess && totalDebitKobo > balanceKobo) {
      return {
        blocked: true,
        reason: `Insufficient wallet balance — you need ${formatNaira(totalDebitKobo)} (incl. fee) but have ${formatNaira(balanceKobo)}.`,
      };
    }
    return { blocked: false, reason: null as string | null };
  }, [usesWallet, amountKobo, totalDebitKobo, balanceKobo, walletQuery.isSuccess]);

  // ── reset when switching transfer type ──────────────────────────────────────
  const switchType = (next: TransferType) => {
    setType(next);
    setStep('form');
    setAmount('');
    setNarration('');
    setSaveBeneficiary(false);
    setRecipient('');
    setResolvedRecipient(null);
    setDest(emptyAccount);
    setSource(emptyAccount);
    setReceipt(null);
  };

  // ── wallet → wallet: resolve recipient ──────────────────────────────────────
  const resolveRecipientMut = useMutation({
    mutationFn: () => resolvePaymaxRecipient(recipient.trim()),
    onSuccess: (data) => {
      setResolvedRecipient(data);
      setStep('review');
    },
  });

  const walletTransferMut = useMutation({
    mutationFn: (_pin: string) =>
      initiateWalletTransfer({
        recipientIdentifier: recipient.trim(),
        amountKobo,
        narration: narration.trim() || undefined,
      }),
    onSuccess: (data: WalletTransfer) => {
      setPinSheet(null);
      setReceipt({
        reference: data.reference,
        amountKobo: data.amountKobo,
        feeKobo: data.feeKobo,
        totalKobo: data.totalDebitKobo || data.amountKobo + data.feeKobo,
        destinationName: data.receiverDisplayName || (resolvedRecipient?.displayName ?? 'Paymax user'),
        destinationDetail: resolvedRecipient?.maskedPhone,
        sourceLabel: 'Wallet',
        status: data.status === 'successful' ? 'successful' : data.status,
        createdAt: data.createdAt,
      });
      setStep('success');
    },
    onError: (e) => setPinError(getErrorMessage(e)),
  });

  // ── auto-resolve destination on 10-digit NUBAN (debounced) ──────────────────
  useEffect(() => {
    if (type === 'wallet_wallet') return;
    if (!dest.bankCode || !/^\d{10}$/.test(dest.accountNumber)) {
      setDest((d) => (d.resolved ? { ...d, resolved: null } : d));
      return;
    }
    const handle = setTimeout(() => {
      resolveAccountMut.mutate(
        { bankCode: dest.bankCode, accountNumber: dest.accountNumber },
        { onSuccess: (r) => setDest((d) => ({ ...d, resolved: r })) },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, dest.bankCode, dest.accountNumber]);

  // ── auto-resolve source (bank → bank) ───────────────────────────────────────
  const resolveSourceMut = useResolveAccount();
  useEffect(() => {
    if (type !== 'bank_bank') return;
    if (!source.bankCode || !/^\d{10}$/.test(source.accountNumber)) {
      setSource((s) => (s.resolved ? { ...s, resolved: null } : s));
      return;
    }
    const handle = setTimeout(() => {
      resolveSourceMut.mutate(
        { bankCode: source.bankCode, accountNumber: source.accountNumber },
        { onSuccess: (r) => setSource((s) => ({ ...s, resolved: r })) },
      );
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, source.bankCode, source.accountNumber]);

  // ── validation for the "Continue to review" button ──────────────────────────
  const canReview = useMemo(() => {
    if (amountKobo < 100) return false;
    if (walletGuard.blocked) return false; // insufficient wallet balance (amount + fee)
    if (type === 'wallet_wallet') return recipient.trim().length > 0;
    if (type === 'wallet_bank') return !!dest.resolved;
    return !!dest.resolved && !!source.resolved;
  }, [type, amountKobo, recipient, dest.resolved, source.resolved, walletGuard.blocked]);

  const goToReview = () => {
    if (type === 'wallet_wallet') {
      resolveRecipientMut.mutate();
      return;
    }
    setStep('review');
  };

  // ── PIN gate: open create or verify based on status ─────────────────────────
  const beginAuthorise = () => {
    setPinError(null);
    const hasPin = pinStatusQuery.data?.hasPin ?? false;
    setPinSheet(hasPin ? 'verify' : 'create');
  };

  const submitTransfer = (pin: string) => {
    setPinError(null);
    // Defense-in-depth: re-assert amount + balance at authorise time so no state
    // manipulation between review and confirm can push through an invalid/over-balance
    // transfer. The backend re-validates fail-closed regardless.
    if (!Number.isInteger(amountKobo) || amountKobo < MIN_TRANSFER_KOBO) {
      setPinError('Enter a valid amount to continue.');
      return;
    }
    if (usesWallet && walletQuery.isSuccess && totalDebitKobo > balanceKobo) {
      setPinError('Insufficient wallet balance for this transfer.');
      return;
    }
    if (type === 'wallet_wallet') {
      walletTransferMut.mutate(pin);
      return;
    }
    if (type === 'wallet_bank' && dest.resolved) {
      walletBankMut.mutate(
        {
          bankCode: dest.bankCode,
          bankName: dest.bankName,
          accountNumber: dest.accountNumber,
          accountName: dest.resolved.accountName,
          amountKobo,
          narration: narration.trim() || undefined,
          saveBeneficiary,
          pin,
        },
        {
          onSuccess: (r) => { setPinSheet(null); setReceipt(r); setStep('success'); },
          onError: (e) => setPinError(getErrorMessage(e)),
        },
      );
      return;
    }
    if (type === 'bank_bank' && dest.resolved && source.resolved) {
      bankBankMut.mutate(
        {
          source: {
            bankCode: source.bankCode,
            bankName: source.bankName,
            accountNumber: source.accountNumber,
            accountName: source.resolved.accountName,
          },
          destination: {
            bankCode: dest.bankCode,
            bankName: dest.bankName,
            accountNumber: dest.accountNumber,
            accountName: dest.resolved.accountName,
          },
          amountKobo,
          narration: narration.trim() || undefined,
          saveBeneficiary,
          pin,
        },
        {
          onSuccess: (r) => { setPinSheet(null); setReceipt(r); setStep('success'); },
          onError: (e) => setPinError(getErrorMessage(e)),
        },
      );
    }
  };

  // After a successful create, immediately treat as verified and run transfer.
  const handlePinSubmit = (pin: string) => {
    if (pinSheet === 'create') {
      createPinMut.mutate(pin, {
        onSuccess: () => { void pinStatusQuery.refetch(); submitTransfer(pin); },
        onError: (e) => setPinError(getErrorMessage(e)),
      });
      return;
    }
    submitTransfer(pin);
  };

  const transferPending =
    walletTransferMut.isPending || walletBankMut.isPending || bankBankMut.isPending || createPinMut.isPending;

  const resetAll = () => switchType(type);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => (step === 'form' ? router.back() : setStep('form'))} style={styles.iconButton}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Send Money</Text>
        <View style={styles.iconButton}>
          <Send size={20} color={Colors.primary} strokeWidth={2.2} />
        </View>
      </View>

      {step === 'form' && (
        <View style={styles.segmentWrap}>
          <SegmentedControl options={SEGMENTS} value={type} onChange={switchType} />
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {step === 'success' && receipt ? (
          <TransferReceipt receipt={receipt} onDone={resetAll} />
        ) : (
          <>
            <Hero type={type} />

            {step === 'form' ? (
              <FormStep
                type={type}
                amount={amount}
                onAmount={setAmount}
                feeKobo={feeKobo}
                balanceKobo={type !== 'bank_bank' ? balanceKobo : undefined}
                recipient={recipient}
                onRecipient={setRecipient}
                narration={narration}
                onNarration={setNarration}
                bankOptions={bankOptions}
                banksLoading={banksQuery.isLoading}
                dest={dest}
                onDest={setDest}
                source={source}
                onSource={setSource}
                destResolving={resolveAccountMut.isPending}
                sourceResolving={resolveSourceMut.isPending}
                beneficiaries={beneficiariesQuery.data ?? []}
                onPickBeneficiary={(b) =>
                  setDest({
                    bankCode: b.bankCode,
                    bankName: b.bankName,
                    accountNumber: '',
                    resolved: { accountName: b.accountName, accountNumber: '', bankCode: b.bankCode },
                  })
                }
              />
            ) : (
              <ReviewStep
                type={type}
                amountKobo={amountKobo}
                feeKobo={feeKobo}
                narration={narration}
                resolvedRecipient={resolvedRecipient}
                dest={dest}
                source={source}
                saveBeneficiary={saveBeneficiary}
                onToggleSave={setSaveBeneficiary}
              />
            )}
          </>
        )}
      </ScrollView>

      {/* Sticky CTA */}
      {step !== 'success' && (
        <View style={styles.footer}>
          {step === 'form' && walletGuard.reason ? (
            <Text style={styles.guardError}>{walletGuard.reason}</Text>
          ) : null}
          {step === 'form' ? (
            <PrimaryButton
              label={resolveRecipientMut.isPending ? 'Looking up…' : 'Continue'}
              onPress={goToReview}
              loading={resolveRecipientMut.isPending}
              disabled={!canReview}
            />
          ) : (
            <PrimaryButton
              label={transferPending ? 'Processing…' : 'Confirm with PIN'}
              onPress={beginAuthorise}
              loading={transferPending}
            />
          )}
        </View>
      )}

      {resolveRecipientMut.isError && step === 'form' && (
        <Text style={styles.bottomError}>{getErrorMessage(resolveRecipientMut.error)}</Text>
      )}

      <PinSheet
        visible={pinSheet !== null}
        mode={pinSheet === 'create' ? 'create' : 'verify'}
        loading={transferPending}
        error={pinError}
        onSubmit={handlePinSubmit}
        onClose={() => { setPinSheet(null); setPinError(null); }}
      />
    </SafeAreaView>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({ type }: { type: TransferType }) {
  const copy: Record<TransferType, { eyebrow: string; title: string; subtitle: string }> = {
    wallet_wallet: {
      eyebrow: 'Wallet → Wallet',
      title: 'Send to Paymax',
      subtitle: 'Instant, free transfers to any Paymax account by phone or email.',
    },
    wallet_bank: {
      eyebrow: 'Wallet → Bank',
      title: 'Send to a bank',
      subtitle: 'Pay any Nigerian bank account straight from your wallet balance.',
    },
    bank_bank: {
      eyebrow: 'Bank → Bank',
      title: 'Bank to bank',
      subtitle: 'Fund from your bank and we disburse to the destination account.',
    },
  };
  const c = copy[type];
  return (
    <LinearGradient
      colors={[Colors.primary, Colors.primaryContainer]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, shadow2]}
    >
      <View style={styles.heroIcon}>
        {type === 'wallet_wallet' ? (
          <Send size={26} color={Colors.onPrimary} strokeWidth={2.2} />
        ) : (
          <Banknote size={26} color={Colors.onPrimary} strokeWidth={2.2} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.heroEyebrow}>{c.eyebrow}</Text>
        <Text style={styles.heroTitle}>{c.title}</Text>
        <Text style={styles.heroSubtitle}>{c.subtitle}</Text>
      </View>
    </LinearGradient>
  );
}

// ── Form step ───────────────────────────────────────────────────────────────

function FormStep(props: {
  type: TransferType;
  amount: string;
  onAmount: (v: string) => void;
  feeKobo: number;
  balanceKobo?: number;
  recipient: string;
  onRecipient: (v: string) => void;
  narration: string;
  onNarration: (v: string) => void;
  bankOptions: { label: string; value: string }[];
  banksLoading: boolean;
  dest: BankAccountState;
  onDest: (s: BankAccountState) => void;
  source: BankAccountState;
  onSource: (s: BankAccountState) => void;
  destResolving: boolean;
  sourceResolving: boolean;
  beneficiaries: Beneficiary[];
  onPickBeneficiary: (b: Beneficiary) => void;
}) {
  const {
    type, amount, onAmount, feeKobo, balanceKobo, recipient, onRecipient, narration, onNarration,
    bankOptions, banksLoading, dest, onDest, source, onSource, destResolving, sourceResolving,
    beneficiaries, onPickBeneficiary,
  } = props;

  return (
    <View style={[styles.card, shadow1]}>
      {type === 'wallet_wallet' && (
        <>
          <Text style={styles.sectionTitle}>Recipient</Text>
          <TextInputField
            label="Phone or email"
            placeholder="0801 234 5678 or name@email.com"
            value={recipient}
            onChangeText={onRecipient}
            autoCapitalize="none"
          />
        </>
      )}

      {type === 'bank_bank' && (
        <View style={styles.payinNote}>
          <Info size={14} color={Colors.onWarning} strokeWidth={2.2} />
          <Text style={styles.payinText}>
            You'll be asked to fund this transfer from your source bank (a secure pay-in step) before we disburse to the destination.
          </Text>
        </View>
      )}

      {type === 'bank_bank' && (
        <>
          <Text style={styles.sectionTitle}>Source account (pay-in)</Text>
          <BankPicker
            label="Source bank"
            value={source.bankCode}
            options={bankOptions}
            loading={banksLoading}
            onChange={(value, opt) => onSource({ ...source, bankCode: value, bankName: opt.label, resolved: null })}
          />
          <TextInputField
            label="Source account number"
            placeholder="10-digit NUBAN"
            value={source.accountNumber}
            onChangeText={(v) => onSource({ ...source, accountNumber: v.replace(/\D/g, '').slice(0, 10) })}
            keyboardType="number-pad"
            maxLength={10}
          />
          <ResolveHint resolving={sourceResolving} name={source.resolved?.accountName} />
          <View style={styles.spacer} />
        </>
      )}

      {(type === 'wallet_bank' || type === 'bank_bank') && (
        <>
          {type === 'wallet_bank' && beneficiaries.length > 0 && (
            <SavedBeneficiaries items={beneficiaries} onPick={onPickBeneficiary} />
          )}

          <Text style={styles.sectionTitle}>{type === 'bank_bank' ? 'Destination account' : 'Recipient bank'}</Text>
          <BankPicker
            label="Destination bank"
            value={dest.bankCode}
            options={bankOptions}
            loading={banksLoading}
            onChange={(value, opt) => onDest({ ...dest, bankCode: value, bankName: opt.label, resolved: null })}
          />
          <TextInputField
            label="Account number"
            placeholder="10-digit NUBAN"
            value={dest.accountNumber}
            onChangeText={(v) => onDest({ ...dest, accountNumber: v.replace(/\D/g, '').slice(0, 10) })}
            keyboardType="number-pad"
            maxLength={10}
          />
          <ResolveHint resolving={destResolving} name={dest.resolved?.accountName} />
        </>
      )}

      <View style={styles.spacer} />
      <Text style={styles.sectionTitle}>Amount</Text>
      <AmountInput
        value={amount}
        onChange={onAmount}
        feeKobo={feeKobo}
        balanceKobo={balanceKobo}
      />

      <TextInputField
        label="Narration (optional)"
        placeholder="e.g. Rent, lunch money"
        value={narration}
        onChangeText={onNarration}
        maxLength={100}
      />
    </View>
  );
}

function ResolveHint({ resolving, name }: { resolving: boolean; name?: string }) {
  if (resolving) {
    return (
      <View style={styles.resolveRow}>
        <StateView kind="loading" message="Verifying account…" compact />
      </View>
    );
  }
  if (name) {
    return (
      <View style={styles.resolvedRow}>
        <BadgeCheck size={16} color={Colors.teal} strokeWidth={2.2} />
        <Text style={styles.resolvedName}>{name}</Text>
      </View>
    );
  }
  return null;
}

function SavedBeneficiaries({ items, onPick }: { items: Beneficiary[]; onPick: (b: Beneficiary) => void }) {
  return (
    <View style={styles.savedBlock}>
      <Text style={styles.savedTitle}>Saved accounts</Text>
      {items.slice(0, 4).map((b) => (
        <Pressable key={b.id} onPress={() => onPick(b)} style={styles.savedRow}>
          <View style={styles.savedIcon}>
            <Building2 size={18} color={Colors.primary} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.savedName}>{b.nickname ?? b.accountName}</Text>
            <Text style={styles.savedSub}>{b.bankName} • •••• {b.accountNumberLast4}</Text>
          </View>
          <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      ))}
      <View style={styles.spacer} />
    </View>
  );
}

// ── Review step ───────────────────────────────────────────────────────────────

function ReviewStep(props: {
  type: TransferType;
  amountKobo: number;
  feeKobo: number;
  narration: string;
  resolvedRecipient: TransferRecipient | null;
  dest: BankAccountState;
  source: BankAccountState;
  saveBeneficiary: boolean;
  onToggleSave: (v: boolean) => void;
}) {
  const { type, amountKobo, feeKobo, narration, resolvedRecipient, dest, source, saveBeneficiary, onToggleSave } = props;

  const destName =
    type === 'wallet_wallet' ? resolvedRecipient?.displayName ?? 'Paymax user' : dest.resolved?.accountName ?? '';
  const destDetail =
    type === 'wallet_wallet'
      ? resolvedRecipient?.maskedPhone
      : `${dest.bankName} • •••• ${dest.accountNumber.slice(-4)}`;

  return (
    <View style={[styles.card, shadow1]}>
      <Text style={styles.sectionTitle}>Review transfer</Text>

      {type === 'bank_bank' && source.resolved && (
        <>
          <PartyRow
            icon="source"
            label="Pay in from"
            name={source.resolved.accountName}
            detail={`${source.bankName} • •••• ${source.accountNumber.slice(-4)}`}
          />
          <View style={styles.divider} />
        </>
      )}

      <PartyRow icon="dest" label="Sending to" name={destName} detail={destDetail} />

      <View style={styles.divider} />

      <Breakdown amountKobo={amountKobo} feeKobo={feeKobo} />

      {narration.trim().length > 0 && (
        <>
          <View style={styles.divider} />
          <View style={styles.kvRow}>
            <Text style={styles.kvKey}>Narration</Text>
            <Text style={styles.kvVal} numberOfLines={2}>{narration.trim()}</Text>
          </View>
        </>
      )}

      {type !== 'wallet_wallet' && (
        <View style={styles.saveRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.saveLabel}>Save as beneficiary</Text>
            <Text style={styles.saveSub}>Re-use this account next time</Text>
          </View>
          <Switch
            value={saveBeneficiary}
            onValueChange={onToggleSave}
            trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
            thumbColor={Colors.onPrimary}
          />
        </View>
      )}

      {type === 'bank_bank' && (
        <View style={styles.payinNote}>
          <Info size={14} color={Colors.onWarning} strokeWidth={2.2} />
          <Text style={styles.payinText}>
            Funds are collected from your source bank, then disbursed to the destination via our payments provider.
          </Text>
        </View>
      )}

      <View style={styles.secureRow}>
        <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
        <Text style={styles.secureText}>You'll authorise this with your transaction PIN.</Text>
      </View>
    </View>
  );
}

function PartyRow({ icon, label, name, detail }: { icon: 'source' | 'dest'; label: string; name: string; detail?: string }) {
  return (
    <View style={styles.partyRow}>
      <View style={styles.partyAvatar}>
        {icon === 'dest' ? (
          <User size={20} color={Colors.primary} strokeWidth={2.2} />
        ) : (
          <Building2 size={20} color={Colors.primary} strokeWidth={2.2} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.partyLabel}>{label}</Text>
        <Text style={styles.partyName}>{name}</Text>
        {detail ? <Text style={styles.partySub}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function Breakdown({ amountKobo, feeKobo }: { amountKobo: number; feeKobo: number }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Amount</Text>
        <Text style={styles.kvVal}>{formatNaira(amountKobo)}</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Fee</Text>
        <Text style={[styles.kvVal, feeKobo === 0 && { color: Colors.teal }]}>
          {feeKobo === 0 ? 'Free' : formatNaira(feeKobo)}
        </Text>
      </View>
      <View style={[styles.kvRow, styles.totalRow]}>
        <Text style={styles.totalKey}>Total</Text>
        <Text style={styles.totalVal}>{formatNaira(amountKobo + feeKobo)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(248,249,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  segmentWrap: { paddingVertical: Spacing.md, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 140 : 120,
  },
  hero: {
    minHeight: 132,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEyebrow: { ...Typography.labelSm, color: Colors.inverseOnSurface, opacity: 0.9 },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary, marginTop: 2 },
  heroSubtitle: { ...Typography.bodySm, color: Colors.inverseOnSurface, marginTop: 2 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  spacer: { height: Spacing.sm },
  // resolve hint
  resolveRow: { marginTop: -Spacing.sm, marginBottom: Spacing.sm, alignItems: 'flex-start' },
  resolvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
    backgroundColor: Colors.iconBgTeal,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  resolvedName: { ...Typography.labelMd, color: Colors.onSurface },
  // pay-in note
  payinNote: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  payinText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  // saved beneficiaries
  savedBlock: { marginBottom: Spacing.sm },
  savedTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerLow,
  },
  savedIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedName: { ...Typography.labelMd, color: Colors.onSurface },
  savedSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  // review
  partyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  partyAvatar: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partyLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  partyName: { ...Typography.titleMd, color: Colors.onSurface },
  partySub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  kvKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kvVal: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  totalRow: { paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, marginTop: Spacing.xs },
  totalKey: { ...Typography.labelMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  saveLabel: { ...Typography.labelMd, color: Colors.onSurface },
  saveSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  secureRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginTop: Spacing.md,
  },
  secureText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  // footer
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.lg,
    backgroundColor: 'rgba(248,249,255,0.96)',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
  },
  bottomError: {
    ...Typography.labelSm,
    color: Colors.error,
    textAlign: 'center',
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.sm,
  },
  guardError: {
    ...Typography.labelSm,
    color: Colors.error,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
});
