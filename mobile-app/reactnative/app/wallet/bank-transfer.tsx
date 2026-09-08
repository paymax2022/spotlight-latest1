import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Copy, Check, Landmark } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { getVirtualAccount } from '@/api/wallet.api';

// Same copy-then-fall-back-to-share pattern used by referral/home/my-code.tsx —
// expo-clipboard isn't guaranteed present on every build target.
async function copyText(value: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(value); return true; }
  } catch { /* fall through */ }
  try { await Share.share({ message: value }); return true; } catch { return false; }
}

export default function BankTransferScreen() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['wallet', 'virtual-account'],
    queryFn: getVirtualAccount,
    retry: false,
  });
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!data?.accountNumber) return;
    const ok = await copyText(data.accountNumber);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };

  // The Tier-1 gate (topup-gate.ts's STANDALONE_TOPUP_TIER) is enforced
  // server-side and surfaces as a 403 here — distinguish it from a generic
  // error so an unverified user gets a next step, not a dead end.
  const isTierBlocked = isError && (error as any)?.response?.status === 403;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bank transfer" subtitle="Fund your wallet from any bank app" />

      {isLoading ? (
        <StateView kind="loading" message="Getting your account details…" />
      ) : isTierBlocked ? (
        <StateView
          kind="empty"
          icon="ShieldCheck"
          title="Verify your identity first"
          message="Bank transfer needs Tier 1 verification — the same level card top-up requires."
          actionLabel="Start verification"
          onAction={() => router.push('/kyc-verify')}
        />
      ) : isError || !data?.accountNumber ? (
        <StateView kind="error" title="Couldn't load your account" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, shadow1]}>
            <View style={styles.bankRow}>
              <View style={styles.bankIcon}><Landmark size={20} color={Colors.primary} strokeWidth={2} /></View>
              <Text style={styles.bankName}>{data.bankName}</Text>
            </View>

            <Text style={styles.label}>Account number</Text>
            <Pressable onPress={onCopy} style={styles.numberRow} accessibilityRole="button" accessibilityLabel="Copy account number">
              <Text style={styles.number}>{data.accountNumber}</Text>
              {copied ? <Check size={18} color="#16A34A" strokeWidth={2.4} /> : <Copy size={18} color={Colors.secondary} strokeWidth={2} />}
            </Pressable>

            <Text style={styles.label}>Account name</Text>
            <Text style={styles.value}>{data.accountName}</Text>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteText}>
              This account number is yours — transfers into it credit your Paymax wallet automatically,
              usually within a minute of the transfer clearing.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    gap: Spacing.xs,
  },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  bankIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  bankName: { ...Typography.titleMd, color: Colors.onSurface },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  numberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  number: { ...Typography.headlineMd, color: Colors.onSurface, letterSpacing: 1 },
  value: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  noteCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
