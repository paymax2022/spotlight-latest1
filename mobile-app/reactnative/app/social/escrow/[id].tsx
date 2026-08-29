import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Package, ShieldAlert, X, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EscrowStatusChip from '@/features/social/components/escrow-EscrowStatusChip';
import { useTrade, useReleaseEscrow, useRaiseDispute, formatNaira } from '@/features/social/escrow';
import { SocialColors } from '@/features/social/constants/social.constants';

const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: 'Under review by Paymax',
  resolved_release: 'Resolved — funds released to seller',
  resolved_refund: 'Resolved — you were refunded',
};

export default function EscrowDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trade = useTrade(id ?? '');
  const release = useReleaseEscrow(id ?? '');
  const dispute = useRaiseDispute(id ?? '');

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const t = trade.data;
  const isBuyer = t?.role === 'buyer';
  const canAct = t?.status === 'HELD' && isBuyer;

  const submitDispute = async () => {
    await dispute.mutateAsync(reason);
    setDisputeOpen(false);
    setReason('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Escrow trade</Text>
        <View style={styles.iconBtn} />
      </View>

      {trade.isLoading ? (
        <StateView kind="loading" message="Loading trade…" />
      ) : trade.isError || !t ? (
        <StateView kind="error" title="Couldn't load trade" actionLabel="Retry" onAction={() => trade.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.itemCard}>
              <View style={[styles.thumb, { backgroundColor: t.thumbColor }]}><Package size={22} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{t.listingTitle}</Text>
                <Text style={styles.itemSeller}>{isBuyer ? 'Seller' : 'Buyer'} {t.counterparty}</Text>
              </View>
              <EscrowStatusChip status={t.status} />
            </View>

            <View style={styles.amountCard}>
              <Text style={styles.amountLabel}>{t.status === 'HELD' ? 'Held in escrow' : 'Amount'}</Text>
              <Text style={styles.amountValue}>{formatNaira(t.amountKobo)}</Text>
            </View>

            {/* Dispute status block */}
            {t.status === 'DISPUTED' || t.disputeReason ? (
              <View style={styles.disputeCard}>
                <View style={styles.disputeHead}><ShieldAlert size={18} color={SocialColors.danger} /><Text style={styles.disputeTitle}>Dispute</Text></View>
                {t.disputeReason ? <Text style={styles.disputeReason}>“{t.disputeReason}”</Text> : null}
                {t.disputeStatus ? <Text style={styles.disputeStatus}>{DISPUTE_STATUS_LABEL[t.disputeStatus]}</Text> : null}
              </View>
            ) : null}

            {/* Timeline / guidance */}
            <View style={styles.infoCard}>
              {t.status === 'HELD' && isBuyer ? (
                <Text style={styles.infoText}>Funds are held safely. Once you receive and inspect the item, release the payment. If there's a problem, raise a dispute.</Text>
              ) : t.status === 'HELD' ? (
                <Text style={styles.infoText}>Waiting for the buyer to confirm receipt. Funds will be released to you on confirmation.</Text>
              ) : t.status === 'RELEASED' ? (
                <View style={styles.doneRow}><CheckCircle2 size={16} color={SocialColors.ok} /><Text style={styles.infoText}>Funds released. This trade is complete.</Text></View>
              ) : t.status === 'REFUNDED' ? (
                <View style={styles.doneRow}><CheckCircle2 size={16} color={SocialColors.muted} /><Text style={styles.infoText}>This trade was refunded.</Text></View>
              ) : (
                <Text style={styles.infoText}>This dispute is being reviewed. Your funds stay protected until it's resolved.</Text>
              )}
            </View>

            <View style={{ height: 140 }} />
          </ScrollView>

          {canAct ? (
            <View style={styles.footer}>
              <PrimaryButton label="Confirm received & release funds" onPress={() => release.mutate()} loading={release.isPending} />
              <Pressable onPress={() => setDisputeOpen(true)} style={styles.disputeBtn}><Text style={styles.disputeBtnText}>Something's wrong — raise a dispute</Text></Pressable>
            </View>
          ) : null}
        </>
      )}

      <Modal visible={disputeOpen} transparent animationType="slide" onRequestClose={() => setDisputeOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Raise a dispute</Text>
              <Pressable onPress={() => setDisputeOpen(false)} hitSlop={10}><X size={22} color={SocialColors.muted} /></Pressable>
            </View>
            <Text style={styles.sheetSub}>Tell us what went wrong. Paymax will review and your funds stay held meanwhile.</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Describe the issue…" placeholderTextColor={SocialColors.muted} value={reason} onChangeText={setReason} multiline />
            <PrimaryButton label="Submit dispute" variant="danger" onPress={submitDispute} disabled={reason.trim().length < 5} loading={dispute.isPending} style={{ marginTop: Spacing.md }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  thumb: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { ...Typography.titleMd, color: SocialColors.text },
  itemSeller: { ...Typography.bodySm, color: SocialColors.muted },
  amountCard: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md },
  amountLabel: { ...Typography.labelMd, color: SocialColors.muted },
  amountValue: { ...Typography.headlineMd, color: SocialColors.text, marginTop: 2 },
  disputeCard: { backgroundColor: SocialColors.dangerBg, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md, gap: 6 },
  disputeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disputeTitle: { ...Typography.titleMd, color: SocialColors.danger },
  disputeReason: { ...Typography.bodyMd, color: SocialColors.text, fontStyle: 'italic' },
  disputeStatus: { ...Typography.labelMd, color: SocialColors.danger },
  infoCard: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md, ...shadow1 },
  infoText: { ...Typography.bodyMd, color: SocialColors.muted, flex: 1 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  disputeBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  disputeBtnText: { ...Typography.labelMd, color: SocialColors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleLg, color: SocialColors.text },
  sheetSub: { ...Typography.bodySm, color: SocialColors.muted, marginTop: 4 },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: SocialColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: SocialColors.surface, marginTop: Spacing.md },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
});
