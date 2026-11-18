import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, AtSign } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import {
  useRequest, usePayRequest, useDeclineRequest, useCancelRequest,
} from '@/features/social/hooks';
import { canPay, canDecline, canCancel, counterpartLabel, statusCopy, requestFailure, shortfallCopy } from '@/features/social/lib/requests';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';
import { getWallet } from '@/api/wallet.api';
import { normalizeApiError } from '@/utils/errorMapper';
import { confirmAsync, alertAsync } from '@/lib/confirm';

// The screen the receiver of a cashtag request needs: see who asked, for how
// much, and settle it. Before this existed the request could only be created —
// @doctor could ask @staging11 for ₦200 and @staging11 had no way to answer.
export default function MoneyRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = String(id ?? '');

  const requestQuery = useRequest(requestId);
  const pay = usePayRequest(requestId);
  const decline = useDeclineRequest(requestId);
  const cancel = useCancelRequest(requestId);

  // Same key and same guards as the Send money screen: paying a request is a
  // wallet debit, so the balance that decides it is the one Add Money writes.
  const walletQuery = useQuery({ queryKey: ['wallet', 'balance'], queryFn: getWallet, staleTime: 30_000 });
  const balanceKobo = Math.round((walletQuery.data?.balance ?? 0) * 100); // Wallet.balance is naira major units
  // Only a balance the app actually read may refuse a payment. When the read
  // failed this stays quiet and lets the ledger's own refusal speak.
  const balanceKnown = walletQuery.isSuccess && walletQuery.data?.balanceUnavailable !== true;

  const req = requestQuery.data;

  if (requestQuery.isLoading) {
    return <Shell><StateView kind="loading" message="Loading request…" /></Shell>;
  }
  if (requestQuery.isError) {
    return (
      <Shell>
        <StateView kind="error" title="Couldn't load this request" actionLabel="Retry" onAction={() => requestQuery.refetch()} />
      </Shell>
    );
  }
  // The detail read is the party-scoped list, so a request that is not the
  // caller's — or one since deleted — legitimately has no row here.
  if (!req) {
    return (
      <Shell>
        <StateView
          kind="empty"
          title="Request not found"
          message="This request is not on your account, or it is no longer available."
          icon="HandCoins"
          actionLabel="Back to requests"
          onAction={() => router.replace('/social/requests')}
        />
      </Shell>
    );
  }

  const amountLabel = formatNaira(req.amountKobo, { decimals: true });
  const busy = pay.isPending || decline.isPending || cancel.isPending;

  /**
   * The one offer a short wallet needs: say what is missing, then take them to
   * Add Money. Built on confirmAsync (not a raw Alert, which renders nothing on
   * web) straight to the committed /wallet/add route, so this screen depends on
   * no helper outside the requests module.
   */
  const promptTopUp = async (message: string) => {
    const go = await confirmAsync({
      title: 'Insufficient balance',
      message,
      confirmLabel: 'Top up wallet',
      cancelLabel: 'Not now',
    });
    if (go) router.push('/wallet/add');
  };

  const showFailure = async (error: unknown) => {
    const failure = requestFailure(normalizeApiError(error), {
      amountLabel,
      balanceLabel: balanceKnown ? formatNaira(balanceKobo, { decimals: true }) : undefined,
    });
    if (failure.cta === 'top_up') {
      await promptTopUp(failure.message);
      return;
    }
    if (failure.cta === 'verify') {
      const go = await confirmAsync({
        title: failure.title,
        message: failure.message,
        confirmLabel: failure.ctaLabel,
        cancelLabel: 'Not now',
      });
      if (go) router.push('/kyc');
      return;
    }
    await alertAsync({ title: failure.title, message: failure.message });
  };

  const payIt = async () => {
    if (!canPay(req) || busy) return;
    // Pre-flight the wallet before spending a request the ledger will refuse.
    // Only a balance the app actually read may refuse the payment here; when
    // the read failed the payment goes ahead and requestFailure answers with
    // the server's own refusal instead — a shortfall, a locked wallet, or a
    // stale state, each with its own dialog.
    if (balanceKnown && req.amountKobo > balanceKobo) {
      await promptTopUp(shortfallCopy(amountLabel, formatNaira(balanceKobo, { decimals: true })));
      return;
    }
    try {
      await pay.mutateAsync();
    } catch (error) {
      await showFailure(error);
    }
  };

  // The state flips (decline/cancel) rather than the balance, so a refusal gets
  // its own title and the classified sentence — stripModuleWrap inside
  // requestFailure keeps Go's internal wrap out of the dialog. The common real
  // case is the request having been settled or cancelled in another session.
  const reportStateFailure = async (error: unknown, fallback: string) => {
    const failure = requestFailure(normalizeApiError(error));
    await alertAsync({ title: fallback, message: failure.message });
  };

  // Decline and cancel are terminal on the backend (PENDING is the only state
  // with exits), so both are confirmed first — and both go through
  // confirmAsync, never a raw Alert, which is a silent no-op on web.
  const declineIt = async () => {
    if (!canDecline(req) || busy) return;
    const go = await confirmAsync({
      title: `Decline ${counterpartLabel(req)}’s request?`,
      message: `This tells them you will not pay ${amountLabel}. You can’t reverse it — you would need a new request.`,
      confirmLabel: 'Decline request',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!go) return;
    try {
      await decline.mutateAsync();
    } catch (error) {
      await reportStateFailure(error, 'Could not decline');
    }
  };

  const cancelIt = async () => {
    if (!canCancel(req) || busy) return;
    const go = await confirmAsync({
      title: 'Cancel this request?',
      message: `${counterpartLabel(req)} will no longer be able to pay ${amountLabel}. You can’t undo this.`,
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!go) return;
    try {
      await cancel.mutateAsync();
    } catch (error) {
      await reportStateFailure(error, 'Could not cancel');
    }
  };

  const settled = req.state !== 'PENDING';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroAmount}>{amountLabel}</Text>
          <Text style={styles.heroVerb}>
            {req.direction === 'incoming' ? 'requested from you' : 'you asked for'}
          </Text>
        </View>

        <View style={styles.partyCard}>
          <CashtagAvatar name={counterpartLabel(req)} handle={req.counterpartHandle || undefined} color={Colors.primary} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.partyName}>{counterpartLabel(req)}</Text>
            {req.counterpartHandle ? (
              <View style={styles.partyHandleRow}>
                <AtSign size={13} color={SocialColors.muted} />
                <Text style={styles.partyHandle}>{req.counterpartHandle.replace(/^@/, '')}</Text>
              </View>
            ) : (
              <Text style={styles.partyHandle}>No cashtag on this account</Text>
            )}
          </View>
          <View style={styles.statusChip}>
            <Text style={styles.statusText}>{statusCopy(req)}</Text>
          </View>
        </View>

        {req.note ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>Note</Text>
            <Text style={styles.noteText}>{req.note}</Text>
          </View>
        ) : null}

        {req.createdAtISO ? (
          <Text style={styles.created}>Asked on {new Date(req.createdAtISO).toLocaleString()}</Text>
        ) : null}

        {canPay(req) ? (
          <View style={styles.actions}>
            <PrimaryButton label={`Pay ${amountLabel}`} onPress={payIt} loading={pay.isPending} disabled={busy} />
            <PrimaryButton label="Decline" variant="ghost" onPress={declineIt} disabled={busy} style={{ marginTop: Spacing.xs }} />
          </View>
        ) : null}

        {canCancel(req) ? (
          <View style={styles.actions}>
            <PrimaryButton label="Cancel request" variant="danger" onPress={cancelIt} loading={cancel.isPending} disabled={busy} />
          </View>
        ) : null}

        {settled ? (
          <View style={[styles.settledCard, req.state === 'PAID' && styles.settledPaid]}>
            <CircleCheck size={20} color={req.state === 'PAID' ? SocialColors.ok : SocialColors.muted} />
            <Text style={styles.settledText}>{statusCopy(req)}</Text>
          </View>
        ) : null}

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 4, paddingVertical: Spacing.md },
  heroAmount: { ...Typography.headlineLg, color: Colors.onSurface },
  heroVerb: { ...Typography.bodyMd, color: SocialColors.muted },
  partyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  partyName: { ...Typography.titleMd, color: Colors.onSurface },
  partyHandleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  partyHandle: { ...Typography.bodySm, color: SocialColors.muted },
  statusChip: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  statusText: { ...Typography.caption, color: SocialColors.text },
  noteCard: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  noteLabel: { ...Typography.labelSm, color: SocialColors.muted },
  noteText: { ...Typography.bodyMd, color: Colors.onSurface },
  created: { ...Typography.bodySm, color: SocialColors.muted },
  actions: { gap: Spacing.xs, marginTop: Spacing.sm },
  settledCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, backgroundColor: SocialColors.surfaceAlt },
  settledPaid: { backgroundColor: SocialColors.okBg },
  settledText: { ...Typography.bodySm, color: Colors.onSurface },
});
