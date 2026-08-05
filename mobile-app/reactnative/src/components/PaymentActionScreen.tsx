import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { initiateFunding } from '@/api/wallet.api';
import {
  resolvePaymaxRecipient,
  initiateWalletTransfer,
  calculateTransferFee,
} from '@/api/transfers.api';
import {
  fetchBeneficiaries,
  resolveBankAccount,
  initiateBankTransfer,
  calculateBankTransferFee,
} from '@/api/beneficiaries.api';
import { fetchBanks } from '@/features/transfers/api';
import BankPicker from '@/features/transfers/components/BankPicker';
import type { TransferRecipient, WalletTransfer, Beneficiary, BankTransferResult } from '@/types/wallet';
import { sanitizeMoneyInput } from '@/utils/money';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { shadow1, shadow2 } from '@/constants/shadows';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';

type ActionKind = 'fund' | 'transfer' | 'withdraw' | 'cards' | 'fx';

interface ActionConfig {
  title: string;
  subtitle: string;
  icon: keyof typeof Icons;
  accent: string;
  eyebrow: string;
  primaryAction: string;
  helper: string;
}

const ACTIONS: Record<ActionKind, ActionConfig> = {
  fund: {
    title: 'Add Money',
    subtitle: 'Fund your Spotlight wallet securely with Paystack.',
    icon: 'Plus',
    accent: Colors.primary,
    eyebrow: 'Wallet funding',
    primaryAction: 'Continue to Paystack',
    helper: 'You will complete funding on Paystack, then return to Spotlight after verification.',
  },
  transfer: {
    title: 'Send Money',
    subtitle: 'Prepare a wallet transfer to another Spotlight account.',
    icon: 'Send',
    accent: Colors.secondary,
    eyebrow: 'Transfer',
    primaryAction: 'Save Transfer Draft',
    helper: 'Transfers are held as a secure placeholder until wallet-to-wallet settlement is enabled.',
  },
  withdraw: {
    title: 'Withdraw',
    subtitle: 'Set up a withdrawal request from your wallet balance.',
    icon: 'ArrowDownToLine',
    accent: Colors.teal,
    eyebrow: 'Payout',
    primaryAction: 'Save Withdrawal Draft',
    helper: 'Withdrawals require payout beneficiary verification before release.',
  },
  cards: {
    title: 'Cards & Methods',
    subtitle: 'Manage secure payment rails for wallet funding and checkout.',
    icon: 'CreditCard',
    accent: Colors.secondary,
    eyebrow: 'Payment methods',
    primaryAction: 'Add Card',
    helper: 'Saved cards need a backend tokenization endpoint before they can be activated.',
  },
  fx: {
    title: 'FX Exchange',
    subtitle: 'Preview currency exchange support for your wallet.',
    icon: 'RefreshCw',
    accent: Colors.teal,
    eyebrow: 'Exchange',
    primaryAction: 'Preview Exchange',
    helper: 'FX conversion will use live rates and a confirmation step before debiting your wallet.',
  },
};

const QUICK_AMOUNTS = ['1000', '2500', '5000', '10000'];

function DynamicIcon({ name, color, size = 24 }: { name: keyof typeof Icons; color: string; size?: number }) {
  const IconComponent = Icons[name] as unknown as Icons.LucideIcon | undefined;
  const Fallback = Icons.Circle;
  const Icon = IconComponent ?? Fallback;
  return <Icon size={size} color={color} strokeWidth={2.2} />;
}

// Paymax wallet-to-wallet transfer flow: 'form' → 'confirm' → 'success'
type TransferStep = 'form' | 'confirm' | 'success';

// Bank transfer flow: 'pick' → 'manual' → 'confirm' → 'success'
// 'pick'   = show saved beneficiaries + "+ New account" button
// 'manual' = bank code + account number entry (resolves to name)
// 'confirm'= amount + narration + save toggle
// 'success'= receipt
type BankStep = 'pick' | 'manual' | 'confirm' | 'success';

export default function PaymentActionScreen({ kind }: { kind: ActionKind }) {
  const config = ACTIONS[kind];
  const [amount, setAmount] = useState(kind === 'fund' ? '5000' : '');
  const [recipient, setRecipient] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');

  // Paymax transfer state
  const [transferStep, setTransferStep] = useState<TransferStep>('form');
  const [resolvedRecipient, setResolvedRecipient] = useState<TransferRecipient | null>(null);
  const [completedTransfer, setCompletedTransfer] = useState<WalletTransfer | null>(null);

  // Bank transfer state
  const [bankStep, setBankStep] = useState<BankStep>('pick');
  const [bankCode, setBankCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedAccount, setResolvedAccount] = useState<{ accountName: string; bankName: string } | null>(null);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
  const [saveBeneficiary, setSaveBeneficiary] = useState(false);
  const [completedBankTransfer, setCompletedBankTransfer] = useState<BankTransferResult | null>(null);

  // Fetch saved beneficiaries when on the withdraw tab
  const beneficiariesQuery = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: fetchBeneficiaries,
    enabled: kind === 'withdraw',
    staleTime: 60_000,
  });

  // Full Nigerian bank list for the searchable "New account" dropdown
  const banksQuery = useQuery({
    queryKey: ['banks'],
    queryFn: fetchBanks,
    enabled: kind === 'withdraw',
    staleTime: 60 * 60_000, // banks rarely change
  });

  const amountValue = useMemo(() => Number(amount.replace(/[^\d.]/g, '')), [amount]);
  const amountKobo = useMemo(() => Math.round(amountValue * 100), [amountValue]);
  const feeKobo = useMemo(() => calculateTransferFee(amountKobo), [amountKobo]);

  // ── Wallet funding mutation ─────────────────────────────────────────────────
  const fundMutation = useMutation({
    mutationFn: async () => {
      if (!amountValue || amountValue < 100) {
        throw new Error('Enter an amount of at least ₦100.');
      }
      return initiateFunding({ amount: Math.round(amountValue * 100) });
    },
    onSuccess: async (result) => {
      if (!result.authorizationUrl) {
        Alert.alert('Funding Started', `Reference: ${result.reference}`);
        return;
      }
      const canOpen = await Linking.canOpenURL(result.authorizationUrl);
      if (canOpen) {
        await Linking.openURL(result.authorizationUrl);
      } else {
        Alert.alert('Funding Link Ready', result.authorizationUrl);
      }
    },
    onError: (error) => {
      Alert.alert('Could not start funding', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  // ── Transfer: step 1 — resolve recipient ───────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!recipient.trim()) throw new Error('Enter a phone number or email address.');
      if (!amountKobo || amountKobo < 100) throw new Error('Enter an amount of at least ₦1.');
      return resolvePaymaxRecipient(recipient.trim());
    },
    onSuccess: (data) => {
      setResolvedRecipient(data);
      setTransferStep('confirm');
    },
    onError: (error) => {
      Alert.alert(
        'Recipient not found',
        error instanceof Error ? error.message : 'No Paymax user found. Check the number or email.',
      );
    },
  });

  // ── Transfer: step 2 — execute transfer ────────────────────────────────────
  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!recipient.trim() || !amountKobo) throw new Error('Invalid transfer details.');
      return initiateWalletTransfer({
        recipientIdentifier: recipient.trim(),
        amountKobo,
        narration: narration.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setCompletedTransfer(data);
      setTransferStep('success');
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'Transfer failed. Please try again.';
      if (msg.toLowerCase().includes('insufficient')) {
        Alert.alert('Insufficient Balance', 'Fund your wallet to continue.');
      } else if (msg.toLowerCase().includes('limit')) {
        Alert.alert('Daily Limit Reached', 'You have reached your daily transfer limit. Upgrade your KYC to increase limits.');
      } else {
        Alert.alert('Transfer Failed', msg);
      }
    },
  });

  // ── Bank transfer: resolve account name via provider validation API ─────────
  // Runs inline (see auto-resolve effect below) so the user sees the verified
  // account name before continuing — no separate "verify" tap required.
  const resolveAccountMutation = useMutation({
    mutationFn: async () => {
      if (!bankCode.trim()) throw new Error('Select a bank.');
      if (!/^\d{10}$/.test(accountNumber.trim())) throw new Error('Account number must be exactly 10 digits.');
      return resolveBankAccount(bankCode.trim(), accountNumber.trim());
    },
    onSuccess: (data) => {
      setResolvedAccount({ accountName: data.accountName, bankName });
    },
    onError: () => {
      setResolvedAccount(null);
    },
  });

  // Auto-verify the account with the provider once a bank is chosen and a full
  // 10-digit NUBAN is entered (debounced). Mirrors the wallet TransferScreen flow.
  useEffect(() => {
    if (kind !== 'withdraw' || bankStep !== 'manual') return;
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
      if (resolvedAccount) setResolvedAccount(null);
      if (resolveAccountMutation.isError) resolveAccountMutation.reset();
      return;
    }
    const handle = setTimeout(() => resolveAccountMutation.mutate(), 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, bankStep, bankCode, accountNumber]);

  const handleBankChange = (code: string, name: string) => {
    setBankCode(code);
    setBankName(name);
    setResolvedAccount(null);
    resolveAccountMutation.reset();
  };

  const handleAccountNumberChange = (v: string) => {
    setAccountNumber(v.replace(/\D/g, '').slice(0, 10));
    if (resolvedAccount) setResolvedAccount(null);
  };

  // ── Bank transfer: select saved beneficiary ─────────────────────────────────
  const selectBeneficiary = (b: Beneficiary) => {
    setSelectedBeneficiary(b);
    setBankCode(b.bankCode);
    setAccountNumber(b.accountNumberLast4); // display only; actual number from beneficiary
    setResolvedAccount({ accountName: b.accountName, bankName: b.bankName });
    setBankStep('confirm');
  };

  // ── Bank transfer: execute ──────────────────────────────────────────────────
  const bankTransferMutation = useMutation({
    mutationFn: async () => {
      if (!amountKobo || amountKobo < 100_000) throw new Error('Minimum bank transfer is ₦1,000.');
      if (!resolvedAccount) throw new Error('Resolve the account first.');
      return initiateBankTransfer({
        bankCode:        bankCode.trim(),
        bankName:        resolvedAccount.bankName,
        accountNumber:   selectedBeneficiary ? '' : accountNumber.trim(), // server re-resolves for manual; beneficiary stores full number
        accountName:     resolvedAccount.accountName,
        amountKobo,
        narration:       narration.trim() || undefined,
        saveBeneficiary,
      });
    },
    onSuccess: (data) => {
      setCompletedBankTransfer(data);
      setBankStep('success');
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'Transfer failed. Please try again.';
      if (msg.toLowerCase().includes('insufficient')) {
        Alert.alert('Insufficient Balance', 'Top up your wallet to continue.');
      } else if (msg.toLowerCase().includes('limit')) {
        Alert.alert('Daily Limit Reached', 'Upgrade your KYC to increase your daily limit.');
      } else {
        Alert.alert('Transfer Failed', msg);
      }
    },
  });

  const isPending = fundMutation.isPending || resolveMutation.isPending || transferMutation.isPending ||
    resolveAccountMutation.isPending || bankTransferMutation.isPending;

  const resetBankFlow = () => {
    setBankStep('pick');
    setBankCode('');
    setBankName('');
    setAccountNumber('');
    setResolvedAccount(null);
    setSelectedBeneficiary(null);
    setSaveBeneficiary(false);
    setAmount('');
    setNarration('');
    setCompletedBankTransfer(null);
    void beneficiariesQuery.refetch();
  };

  const handlePrimary = () => {
    if (kind === 'fund') { fundMutation.mutate(); return; }
    if (kind === 'transfer') {
      if (transferStep === 'form')    { resolveMutation.mutate(); return; }
      if (transferStep === 'confirm') { transferMutation.mutate(); return; }
      if (transferStep === 'success') {
        setTransferStep('form');
        setRecipient('');
        setAmount('');
        setNarration('');
        setResolvedRecipient(null);
        setCompletedTransfer(null);
        return;
      }
    }
    if (kind === 'withdraw') {
      if (bankStep === 'manual')  { if (resolvedAccount) setBankStep('confirm'); return; }
      if (bankStep === 'confirm') { bankTransferMutation.mutate(); return; }
      if (bankStep === 'success') { resetBankFlow(); return; }
    }
    Alert.alert(config.title, 'This feature is coming soon.');
  };

  const primaryLabel = () => {
    if (kind === 'fund') return fundMutation.isPending ? 'Please wait…' : config.primaryAction;
    if (kind === 'transfer') {
      if (transferStep === 'form')    return resolveMutation.isPending ? 'Looking up recipient…' : 'Preview Transfer';
      if (transferStep === 'confirm') return transferMutation.isPending ? 'Sending…' : 'Confirm & Send';
      return 'Send Another';
    }
    if (kind === 'withdraw') {
      if (bankStep === 'pick')    return '';  // pick step has no primary button (list of beneficiaries)
      if (bankStep === 'manual')  return resolveAccountMutation.isPending ? 'Verifying account…' : 'Continue';
      if (bankStep === 'confirm') return bankTransferMutation.isPending ? 'Sending…' : 'Confirm Transfer';
      if (bankStep === 'success') return 'New Transfer';
    }
    return isPending ? 'Please wait…' : config.primaryAction;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconButton}>
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>{config.title}</Text>
        <View style={styles.iconButton}>
          <DynamicIcon name={config.icon} color={Colors.primary} size={21} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient
          colors={[config.accent, Colors.primaryContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroIcon}>
            <DynamicIcon name={config.icon} color={Colors.onPrimary} size={28} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>{config.eyebrow}</Text>
            <Text style={styles.heroTitle}>{config.title}</Text>
            <Text style={styles.heroSubtitle}>{config.subtitle}</Text>
          </View>
        </LinearGradient>

        {/* ── Bank transfer flow (withdraw kind) ────────────────────── */}
        {kind === 'withdraw' && bankStep === 'success' && completedBankTransfer ? (
          <BankTransferSuccessCard transfer={completedBankTransfer} />
        ) : kind === 'withdraw' && bankStep === 'confirm' && resolvedAccount ? (
          <BankTransferConfirmCard
            accountName={resolvedAccount.accountName}
            bankName={resolvedAccount.bankName}
            accountNumberLast4={selectedBeneficiary ? selectedBeneficiary.accountNumberLast4 : accountNumber.slice(-4)}
            amountKobo={amountKobo}
            feeKobo={calculateBankTransferFee(amountKobo)}
            narration={narration}
            onNarrationChange={setNarration}
            saveBeneficiary={saveBeneficiary}
            onToggleSave={setSaveBeneficiary}
            onBack={() => setBankStep(selectedBeneficiary ? 'pick' : 'manual')}
            amount={amount}
            onAmountChange={setAmount}
          />
        ) : kind === 'withdraw' && bankStep === 'manual' ? (
          <BankAccountEntryCard
            banks={banksQuery.data ?? []}
            banksLoading={banksQuery.isLoading}
            bankCode={bankCode}
            onBankChange={handleBankChange}
            accountNumber={accountNumber}
            onAccountNumberChange={handleAccountNumberChange}
            resolving={resolveAccountMutation.isPending}
            resolvedName={resolvedAccount?.accountName ?? null}
            resolveError={
              resolveAccountMutation.isError
                ? "We couldn't verify this account. Check the number and selected bank."
                : null
            }
            onBack={() => setBankStep('pick')}
          />
        ) : kind === 'withdraw' ? (
          <BeneficiaryPickerCard
            beneficiaries={beneficiariesQuery.data ?? []}
            loading={beneficiariesQuery.isLoading}
            onSelect={selectBeneficiary}
            onNewAccount={() => setBankStep('manual')}
          />

        /* ── Paymax wallet-to-wallet transfer flow ────────────────── */
        ) : kind === 'transfer' && transferStep === 'success' && completedTransfer ? (
          <TransferSuccessCard transfer={completedTransfer} />
        ) : kind === 'transfer' && transferStep === 'confirm' && resolvedRecipient ? (
          <TransferConfirmCard
            recipient={resolvedRecipient}
            amountKobo={amountKobo}
            feeKobo={feeKobo}
            narration={narration}
            onNarrationChange={setNarration}
            onBack={() => setTransferStep('form')}
          />
        ) : kind === 'cards' ? (
          <CardsPanel />
        ) : (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.sectionTitle}>Payment Details</Text>
            <Text style={styles.sectionHint}>{config.helper}</Text>

            {(kind === 'fund' || kind === 'transfer' || kind === 'fx') && (
              <View style={styles.amountBlock}>
                <TextInputField
                  label={kind === 'fx' ? 'Amount to Convert' : 'Amount'}
                  placeholder="₦0.00"
                  value={amount}
                  onChangeText={(v) => setAmount(sanitizeMoneyInput(v))}
                  keyboardType="decimal-pad"
                  maxLength={13}
                />

                <View style={styles.amountGrid}>
                  {QUICK_AMOUNTS.map((item) => (
                    <Pressable key={item} onPress={() => setAmount(item)} style={[styles.amountPill, amount === item && styles.amountPillActive]}>
                      <Text style={[styles.amountText, amount === item && styles.amountTextActive]}>₦{Number(item).toLocaleString('en-NG')}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {kind === 'transfer' && (
              <TextInputField
                label="Recipient"
                placeholder="Phone number or email"
                value={recipient}
                onChangeText={setRecipient}
              />
            )}

            {/* withdraw kind is fully handled by BankTransfer sub-components above */}

            {kind === 'fx' && (
              <>
                <TextInputField label="From" placeholder="NGN Wallet" value="NGN Wallet" editable={false} />
                <TextInputField label="To" placeholder="USD Wallet" value={recipient} onChangeText={setRecipient} />
              </>
            )}
          </View>
        )}

        {transferStep !== 'success' && bankStep !== 'success' && <SecurityPanel />}

        {/* Hide primary button on beneficiary picker (tap-to-select UX) and success */}
        {!(kind === 'withdraw' && bankStep === 'pick') && bankStep !== 'success' && transferStep !== 'success' && (
          <View style={styles.actionWrap}>
            <PrimaryButton
              label={primaryLabel()}
              onPress={handlePrimary}
              loading={isPending}
              disabled={kind === 'withdraw' && bankStep === 'manual' && !resolvedAccount}
            />
          </View>
        )}

        {/* success step CTA */}
        {(transferStep === 'success' || bankStep === 'success') && (
          <View style={styles.actionWrap}>
            <PrimaryButton label={primaryLabel()} onPress={handlePrimary} loading={false} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Transfer sub-components ────────────────────────────────────────────────

function TransferConfirmCard({
  recipient,
  amountKobo,
  feeKobo,
  narration,
  onNarrationChange,
  onBack,
}: {
  recipient: TransferRecipient;
  amountKobo: number;
  feeKobo: number;
  narration: string;
  onNarrationChange: (v: string) => void;
  onBack: () => void;
}) {
  const fmt = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.confirmHeader}>
        <Pressable onPress={onBack} style={styles.confirmBack}>
          <Icons.ArrowLeft size={18} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.confirmBackText}>Edit</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>Review Transfer</Text>
      </View>

      {/* Recipient */}
      <View style={styles.confirmRow}>
        <View style={styles.confirmAvatar}>
          <Icons.User size={22} color={Colors.primary} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.confirmLabel}>Sending to</Text>
          <Text style={styles.confirmValue}>{recipient.displayName}</Text>
          <Text style={styles.confirmSub}>{recipient.maskedPhone}</Text>
        </View>
        <Icons.BadgeCheck size={20} color={Colors.teal} strokeWidth={2} />
      </View>

      <View style={styles.divider} />

      {/* Amount breakdown */}
      <View style={styles.breakdownBlock}>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Transfer amount</Text>
          <Text style={styles.breakdownVal}>{fmt(amountKobo)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Transfer fee</Text>
          <Text style={[styles.breakdownVal, feeKobo === 0 && styles.breakdownFree]}>
            {feeKobo === 0 ? 'Free' : fmt(feeKobo)}
          </Text>
        </View>
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={styles.breakdownTotalKey}>You will be debited</Text>
          <Text style={styles.breakdownTotalVal}>{fmt(amountKobo + feeKobo)}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <TextInputField
        label="Narration (optional)"
        placeholder="e.g. Lunch money"
        value={narration}
        onChangeText={onNarrationChange}
        maxLength={100}
      />

      <View style={styles.warningRow}>
        <Icons.Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
        <Text style={styles.warningText}>
          Transfers are instant. You are sending to {recipient.displayName}. This may not be reversible.
        </Text>
      </View>
    </View>
  );
}

function TransferSuccessCard({ transfer }: { transfer: WalletTransfer }) {
  const fmt = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = new Date(transfer.createdAt).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.successIcon}>
        <Icons.CheckCircle size={44} color={Colors.teal} strokeWidth={1.8} />
      </View>
      <Text style={styles.successTitle}>Transfer Successful</Text>
      <Text style={styles.successSub}>
        {fmt(transfer.amountKobo)} sent to {transfer.receiverDisplayName}
      </Text>

      <View style={styles.divider} />

      <View style={styles.breakdownBlock}>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Amount sent</Text>
          <Text style={styles.breakdownVal}>{fmt(transfer.amountKobo)}</Text>
        </View>
        {transfer.feeKobo > 0 && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownKey}>Fee charged</Text>
            <Text style={styles.breakdownVal}>{fmt(transfer.feeKobo)}</Text>
          </View>
        )}
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Reference</Text>
          <Text style={[styles.breakdownVal, styles.refText]}>{transfer.reference}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Date</Text>
          <Text style={styles.breakdownVal}>{date}</Text>
        </View>
      </View>
    </View>
  );
}

function CardsPanel() {
  const methods = [
    { title: 'Wallet Balance', subtitle: 'Default rail for utility payments', icon: 'Wallet' as const, status: 'Active' },
    { title: 'Paystack Card', subtitle: 'Used during secure hosted checkout', icon: 'CreditCard' as const, status: 'Available' },
    { title: 'Saved Cards', subtitle: 'Requires tokenized card storage API', icon: 'ShieldCheck' as const, status: 'Pending' },
  ];

  return (
    <View style={[styles.card, shadow1]}>
      <Text style={styles.sectionTitle}>Payment Methods</Text>
      <Text style={styles.sectionHint}>Spotlight keeps checkout inside approved wallet and Paystack rails.</Text>
      <View style={styles.methodList}>
        {methods.map((method) => (
          <View key={method.title} style={styles.methodRow}>
            <View style={styles.methodIcon}>
              <DynamicIcon name={method.icon} color={Colors.primary} size={20} />
            </View>
            <View style={styles.methodCopy}>
              <Text style={styles.methodTitle}>{method.title}</Text>
              <Text style={styles.methodSubtitle}>{method.subtitle}</Text>
            </View>
            <Text style={[styles.methodStatus, method.status === 'Pending' && styles.methodStatusPending]}>{method.status}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Bank Transfer sub-components ──────────────────────────────────────────

function BeneficiaryPickerCard({
  beneficiaries,
  loading,
  onSelect,
  onNewAccount,
}: {
  beneficiaries: Beneficiary[];
  loading: boolean;
  onSelect: (b: Beneficiary) => void;
  onNewAccount: () => void;
}) {
  return (
    <View style={[styles.card, shadow1]}>
      <Text style={styles.sectionTitle}>Send to Bank</Text>
      <Text style={styles.sectionHint}>Select a saved account or add a new one.</Text>

      {loading && <Text style={styles.sectionHint}>Loading saved accounts…</Text>}

      {beneficiaries.map((b) => (
        <Pressable key={b.id} onPress={() => onSelect(b)} style={styles.beneficiaryRow}>
          <View style={styles.beneficiaryIcon}>
            <Icons.Building2 size={20} color={Colors.primary} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.beneficiaryName}>{b.nickname ?? b.accountName}</Text>
            <Text style={styles.beneficiarySub}>{b.bankName} • •••• {b.accountNumberLast4}</Text>
          </View>
          <Icons.ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      ))}

      <Pressable onPress={onNewAccount} style={styles.newAccountRow}>
        <View style={[styles.beneficiaryIcon, { backgroundColor: Colors.primaryFixed }]}>
          <Icons.Plus size={20} color={Colors.primary} strokeWidth={2.4} />
        </View>
        <Text style={styles.newAccountText}>New bank account</Text>
        <Icons.ChevronRight size={18} color={Colors.primary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function BankAccountEntryCard({
  banks,
  banksLoading,
  bankCode,
  onBankChange,
  accountNumber,
  onAccountNumberChange,
  resolving,
  resolvedName,
  resolveError,
  onBack,
}: {
  banks: { code: string; name: string }[];
  banksLoading: boolean;
  bankCode: string;
  onBankChange: (code: string, name: string) => void;
  accountNumber: string;
  onAccountNumberChange: (v: string) => void;
  resolving: boolean;
  resolvedName: string | null;
  resolveError: string | null;
  onBack: () => void;
}) {
  const bankOptions = useMemo(
    () => banks.map((b) => ({ label: b.name, value: b.code })),
    [banks],
  );

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.confirmHeader}>
        <Pressable onPress={onBack} style={styles.confirmBack}>
          <Icons.ArrowLeft size={18} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.confirmBackText}>Back</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>New Account</Text>
      </View>
      <Text style={styles.sectionHint}>
        Choose the bank, then enter the 10-digit account number — we'll verify the account name automatically.
      </Text>

      <BankPicker
        label="Bank"
        placeholder="Select bank"
        value={bankCode}
        options={bankOptions}
        onChange={(code, option) => onBankChange(code, option.label)}
        loading={banksLoading}
      />

      <TextInputField
        label="Account Number"
        placeholder="0123456789"
        value={accountNumber}
        onChangeText={onAccountNumberChange}
        keyboardType="number-pad"
        maxLength={10}
      />

      {/* Inline provider-validation feedback */}
      {resolving ? (
        <View style={styles.resolveRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.resolvePending}>Verifying account…</Text>
        </View>
      ) : resolvedName ? (
        <View style={[styles.resolveRow, styles.resolveOk]}>
          <Icons.BadgeCheck size={18} color={Colors.teal} strokeWidth={2.2} />
          <Text style={styles.resolveName} numberOfLines={1}>{resolvedName}</Text>
        </View>
      ) : resolveError ? (
        <View style={[styles.resolveRow, styles.resolveBad]}>
          <Icons.AlertCircle size={16} color={Colors.error} strokeWidth={2.2} />
          <Text style={styles.resolveErrorText}>{resolveError}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BankTransferConfirmCard({
  accountName,
  bankName,
  accountNumberLast4,
  amountKobo,
  feeKobo,
  narration,
  onNarrationChange,
  saveBeneficiary,
  onToggleSave,
  onBack,
  amount,
  onAmountChange,
}: {
  accountName: string;
  bankName: string;
  accountNumberLast4: string;
  amountKobo: number;
  feeKobo: number;
  narration: string;
  onNarrationChange: (v: string) => void;
  saveBeneficiary: boolean;
  onToggleSave: (v: boolean) => void;
  onBack: () => void;
  amount: string;
  onAmountChange: (v: string) => void;
}) {
  const fmt = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.confirmHeader}>
        <Pressable onPress={onBack} style={styles.confirmBack}>
          <Icons.ArrowLeft size={18} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.confirmBackText}>Edit</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>Review Transfer</Text>
      </View>

      <View style={styles.confirmRow}>
        <View style={styles.confirmAvatar}>
          <Icons.Building2 size={22} color={Colors.primary} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.confirmLabel}>Sending to</Text>
          <Text style={styles.confirmValue}>{accountName}</Text>
          <Text style={styles.confirmSub}>{bankName} • •••• {accountNumberLast4}</Text>
        </View>
        <Icons.ShieldCheck size={20} color={Colors.teal} strokeWidth={2} />
      </View>

      <View style={styles.divider} />

      <TextInputField
        label="Amount"
        placeholder="₦0.00"
        value={amount}
        onChangeText={(v) => onAmountChange(sanitizeMoneyInput(v))}
        keyboardType="decimal-pad"
        maxLength={13}
      />

      {amountKobo > 0 && (
        <View style={styles.breakdownBlock}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownKey}>Transfer amount</Text>
            <Text style={styles.breakdownVal}>{fmt(amountKobo)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownKey}>Transfer fee</Text>
            <Text style={styles.breakdownVal}>{fmt(feeKobo)}</Text>
          </View>
          <View style={[styles.breakdownRow, styles.breakdownTotal]}>
            <Text style={styles.breakdownTotalKey}>You will be debited</Text>
            <Text style={styles.breakdownTotalVal}>{fmt(amountKobo + feeKobo)}</Text>
          </View>
        </View>
      )}

      <View style={styles.divider} />

      <TextInputField
        label="Narration (optional)"
        placeholder="e.g. Rent payment"
        value={narration}
        onChangeText={onNarrationChange}
        maxLength={100}
      />

      <View style={styles.saveRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.saveLabel}>Save as beneficiary</Text>
          <Text style={styles.saveSub}>Quickly re-use this account in future transfers</Text>
        </View>
        <Switch
          value={saveBeneficiary}
          onValueChange={onToggleSave}
          trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
          thumbColor={Colors.onPrimary}
        />
      </View>

      <View style={styles.warningRow}>
        <Icons.Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
        <Text style={styles.warningText}>
          Bank transfers are processed by Paystack. Funds are debited immediately; delivery usually takes minutes.
        </Text>
      </View>
    </View>
  );
}

function BankTransferSuccessCard({ transfer }: { transfer: BankTransferResult }) {
  const fmt = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = new Date(transfer.createdAt).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.successIcon}>
        <Icons.CheckCircle size={44} color={Colors.teal} strokeWidth={1.8} />
      </View>
      <Text style={styles.successTitle}>Transfer Initiated</Text>
      <Text style={styles.successSub}>
        {fmt(transfer.amountKobo)} → {transfer.accountName}
      </Text>

      <View style={styles.divider} />

      <View style={styles.breakdownBlock}>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Amount sent</Text>
          <Text style={styles.breakdownVal}>{fmt(transfer.amountKobo)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Fee charged</Text>
          <Text style={styles.breakdownVal}>{fmt(transfer.feeKobo)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Bank</Text>
          <Text style={styles.breakdownVal}>{transfer.bankName}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Account</Text>
          <Text style={styles.breakdownVal}>•••• {transfer.accountNumberLast4}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Reference</Text>
          <Text style={[styles.breakdownVal, styles.refText]}>{transfer.reference}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownKey}>Date</Text>
          <Text style={styles.breakdownVal}>{date}</Text>
        </View>
      </View>

      <View style={styles.warningRow}>
        <Icons.Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
        <Text style={styles.warningText}>
          Funds are typically delivered within minutes. You will receive confirmation once the transfer is complete.
        </Text>
      </View>
    </View>
  );
}

function SecurityPanel() {
  return (
    <View style={styles.securityPanel}>
      <View style={styles.securityIcon}>
        <Icons.ShieldCheck size={18} color={Colors.teal} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.securityTitle}>Protected payment flow</Text>
        <Text style={styles.securityText}>Every payment action keeps authentication, idempotency, and confirmation inside Spotlight-owned APIs.</Text>
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
  content: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96,
  },
  hero: {
    minHeight: 152,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, gap: Spacing.xs },
  heroEyebrow: { ...Typography.labelSm, color: Colors.inverseOnSurface, opacity: 0.9 },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSubtitle: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.md },
  amountBlock: { marginTop: Spacing.xs },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  amountPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  amountPillActive: {
    backgroundColor: Colors.primaryFixed,
    borderColor: Colors.primary,
  },
  amountText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountTextActive: { color: Colors.onPrimaryFixed },
  methodList: { gap: Spacing.sm, marginTop: Spacing.sm },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  methodIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodCopy: { flex: 1 },
  methodTitle: { ...Typography.labelMd, color: Colors.onSurface },
  methodSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  methodStatus: { ...Typography.labelSm, color: Colors.teal },
  methodStatusPending: { color: Colors.outline },
  securityPanel: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  securityIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityTitle: { ...Typography.labelMd, color: Colors.onSurface },
  securityText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  actionWrap: { marginBottom: Spacing.lg },

  // ── Transfer confirm card ─────────────────────────────────────────────────
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  confirmBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingRight: Spacing.sm,
  },
  confirmBackText: { ...Typography.labelSm, color: Colors.primary },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  confirmAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  confirmValue: { ...Typography.titleMd, color: Colors.onSurface },
  confirmSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceContainerHigh,
    marginVertical: Spacing.md,
  },
  breakdownBlock: { gap: Spacing.sm },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  breakdownVal: { ...Typography.labelMd, color: Colors.onSurface },
  breakdownFree: { color: Colors.teal },
  breakdownTotal: {
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    marginTop: Spacing.xs,
  },
  breakdownTotalKey: { ...Typography.labelMd, color: Colors.onSurface },
  breakdownTotalVal: { ...Typography.titleMd, color: Colors.primary },
  refText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontFamily: 'monospace' },
  warningRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginTop: Spacing.md,
  },
  warningText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },

  // ── Transfer success card ─────────────────────────────────────────────────
  successIcon: { alignItems: 'center', paddingVertical: Spacing.lg },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs, marginBottom: Spacing.md },

  // ── Beneficiary picker ────────────────────────────────────────────────────
  beneficiaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  beneficiaryIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beneficiaryName: { ...Typography.labelMd, color: Colors.onSurface },
  beneficiarySub:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  newAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  newAccountText: { ...Typography.labelMd, color: Colors.primary, flex: 1 },

  // ── Inline account resolution feedback ────────────────────────────────────
  resolveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow,
    marginTop: Spacing.xs,
  },
  resolveOk:  { backgroundColor: Colors.iconBgTeal },
  resolveBad: { backgroundColor: Colors.surfaceContainerLow },
  resolvePending:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  resolveName:      { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  resolveErrorText: { ...Typography.bodySm, color: Colors.error, flex: 1 },

  // ── Save beneficiary toggle ───────────────────────────────────────────────
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  saveLabel: { ...Typography.labelMd, color: Colors.onSurface },
  saveSub:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
