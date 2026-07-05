// ── Marketplace — OfferBubble (Screen 19 Deal Room) ──────────────────────────
// An offer is a structured, NON-BINDING price proposal — a bubble with a price
// and a status, never a free-text message that could be misread. Buyer-authored
// offers align right; the counterparty's counters align left. Actions (accept/
// counter/decline) surface only for a live 'pending' offer the current user can
// act on. Accepting just agrees a number for the off-platform meetup — it holds
// no funds and creates no order.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Tag, Check, X, Repeat } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors, formatNaira } from '@/features/marketplace';
import type { Offer, OfferStatus } from '@/features/marketplace';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  countered: 'Countered',
  expired: 'Expired',
};

function statusTint(status: OfferStatus | string): string {
  if (status === 'accepted') return MarketColors.ok;
  if (status === 'declined' || status === 'expired') return MarketColors.muted;
  if (status === 'countered') return MarketColors.accent;
  return MarketColors.brand;
}

export default function OfferBubble({
  offer,
  mine,
  canAct,
  onAccept,
  onCounter,
  onDecline,
  busy,
}: {
  offer: Offer;
  mine: boolean;
  canAct?: boolean;
  onAccept?: () => void;
  onCounter?: () => void;
  onDecline?: () => void;
  busy?: boolean;
}) {
  const tint = statusTint(offer.status);
  const isPending = offer.status === 'pending';
  const isAccepted = offer.status === 'accepted';

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <View style={styles.head}>
          <Tag size={14} color={mine ? MarketColors.brand : MarketColors.accent} />
          <Text style={styles.headText}>{mine ? 'Your offer' : 'Their offer'}</Text>
          <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
            <Text style={[styles.statusText, { color: tint }]}>{STATUS_LABEL[offer.status] ?? offer.status}</Text>
          </View>
        </View>
        <Text style={styles.price}>{formatNaira(offer.offerPriceKobo)}</Text>

        {canAct && isPending ? (
          <View style={styles.actions}>
            <Pressable style={[styles.act, styles.accept]} onPress={onAccept} disabled={busy}>
              <Check size={15} color={MarketColors.surface} />
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
            <Pressable style={[styles.act, styles.counter]} onPress={onCounter} disabled={busy}>
              <Repeat size={15} color={MarketColors.brand} />
              <Text style={styles.counterText}>Counter</Text>
            </Pressable>
            <Pressable style={[styles.act, styles.decline]} onPress={onDecline} disabled={busy}>
              <X size={15} color={MarketColors.danger} />
            </Pressable>
          </View>
        ) : null}

        {isAccepted ? (
          <Text style={styles.agreedNote}>Price agreed — arrange your meetup to complete the deal.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: Spacing.xs },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  bubbleMine: { backgroundColor: MarketColors.warnBg, borderTopRightRadius: Radius.sm },
  bubbleTheirs: { backgroundColor: MarketColors.surfaceAlt, borderTopLeftRadius: Radius.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { ...Typography.labelSm, color: MarketColors.muted, fontWeight: '700', flex: 1 },
  statusPill: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { ...Typography.labelSm, fontWeight: '700' },
  price: { ...Typography.titleLg, color: MarketColors.text, marginTop: 2 },
  agreedNote: { ...Typography.labelSm, color: MarketColors.ok, fontWeight: '600', marginTop: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.sm },
  act: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: Radius.md, paddingVertical: 9, paddingHorizontal: 12 },
  accept: { backgroundColor: MarketColors.brand, flex: 1 },
  acceptText: { ...Typography.labelMd, color: MarketColors.surface, fontWeight: '700' },
  counter: { backgroundColor: MarketColors.surface, borderWidth: 1.5, borderColor: MarketColors.brand, flex: 1 },
  counterText: { ...Typography.labelMd, color: MarketColors.brand, fontWeight: '700' },
  decline: { backgroundColor: MarketColors.surface, borderWidth: 1.5, borderColor: MarketColors.border },
});
