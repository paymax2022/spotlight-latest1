// ── Screen 19 — Deal Room (+ 20 Make Offer, + 27 Meetup entry) ───────────────
// The single most important scam-prevention surface. Structured OFFER BUBBLES
// (non-binding price proposals, not chat text), a counter-offer / make-offer
// sheet, an "Arrange meetup" CTA pinned to the TOP (always visible), a
// scam-language warning banner, and a "continue safely" bridge shown once.
// Connect model: no escrow — an accepted offer just agrees a price for the
// off-platform meetup. Chat text is local (TODO(messaging) in offers.mock.ts).
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, HandCoins, Handshake } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import type { Offer } from '@/features/marketplace';
import {
  useThread,
  useMessages,
  useSendMessage,
  useOffers,
  useCreateOffer,
  useCounterOffer,
  useAcceptOffer,
  useDeclineOffer,
} from '@/features/marketplace/api/transact.hooks';
import type { MockMessage } from '@/features/marketplace/api/offers.api';
import { MOCK_ME } from '@/features/marketplace/api/offers.mock';
import OfferBubble from '../_components/OfferBubble';
import PriceOfferSheet from '../_components/PriceOfferSheet';
import ScamWarningBanner from '../_components/ScamWarningBanner';
import MeetupModeSheet from '../_components/MeetupModeSheet';
import { detectScamHint } from '../_components/transact.constants';

type Item = { kind: 'msg'; msg: MockMessage } | { kind: 'offer'; offer: Offer };

export default function DealRoom() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const threadQ = useThread(threadId ?? '');
  const thread = threadQ.data;
  const listingId = thread?.listingId ?? '';

  const messagesQ = useMessages(threadId ?? '');
  const offersQ = useOffers(listingId);
  const sendMessage = useSendMessage(threadId ?? '');
  const createOffer = useCreateOffer(listingId);
  const counterOffer = useCounterOffer(listingId);
  const acceptOffer = useAcceptOffer(listingId);
  const declineOffer = useDeclineOffer(listingId);

  const [draft, setDraft] = useState('');
  const [offerSheet, setOfferSheet] = useState<'make' | { counterOf: string } | null>(null);
  const [meetupOpen, setMeetupOpen] = useState(false);
  // Scam banner: fire on any matching message; bridge shows once banner has shown.
  const [scamHint, setScamHint] = useState<string | null>(null);
  const [bridgeUnlocked, setBridgeUnlocked] = useState(false);
  const [offPlatformAck, setOffPlatformAck] = useState(false);

  // Detect scam patterns across the whole conversation on load.
  const scamFromHistory = useMemo(() => {
    const msgs = messagesQ.data ?? [];
    for (const m of msgs) {
      const h = detectScamHint(m.text);
      if (h) return h;
    }
    return null;
  }, [messagesQ.data]);
  const effectiveScamHint = scamHint ?? scamFromHistory;

  const items: Item[] = useMemo(() => {
    const msgs = (messagesQ.data ?? []).map((m) => ({ kind: 'msg' as const, msg: m, at: m.createdAt }));
    const offs = (offersQ.data ?? []).map((o) => ({ kind: 'offer' as const, offer: o, at: o.createdAt }));
    return [...msgs, ...offs].sort((a, b) => (a.at < b.at ? -1 : 1)).map(({ at: _at, ...rest }) => rest as Item);
  }, [messagesQ.data, offersQ.data]);

  const acceptedOffer = (offersQ.data ?? []).find((o) => o.status === 'accepted') ?? null;
  const listRef = useRef<FlatList<Item>>(null);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    const hint = detectScamHint(text);
    if (hint) {
      setScamHint(hint);
      setBridgeUnlocked(true); // warned at least once → bridge becomes available
    }
    setDraft('');
    sendMessage.mutate(text);
  };

  if (threadQ.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Deal room" />
        <StateView kind="loading" message="Opening deal room…" />
      </SafeAreaView>
    );
  }
  if (threadQ.isError || !thread) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Deal room" />
        <StateView kind="error" title="Couldn't open this deal" actionLabel="Retry" onAction={() => threadQ.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header title={thread.counterpartyName} subtitle={thread.listingTitle} />

      {/* ── Pinned ARRANGE-MEETUP CTA — always visible, never scrolled away. In
          the connect model there is no escrow: an accepted offer just fixes a
          price to arrange the meetup around. ── */}
      <View style={styles.pinned}>
        <View style={styles.pinnedInfo}>
          <Text style={styles.pinnedTitle} numberOfLines={1}>{thread.listingTitle}</Text>
          <Text style={styles.pinnedPrice}>
            {acceptedOffer
              ? `Agreed ${formatNaira(acceptedOffer.offerPriceKobo)} — arrange your meetup`
              : formatNaira(thread.listingPriceKobo)}
          </Text>
        </View>
        <Pressable style={styles.meetupBtn} onPress={() => setMeetupOpen(true)} accessibilityRole="button">
          <Handshake size={16} color={MarketColors.brand} />
          <Text style={styles.meetupBtnText}>Arrange meetup</Text>
        </Pressable>
      </View>

      {effectiveScamHint ? (
        <View style={styles.bannerWrap}>
          <ScamWarningBanner
            hint={effectiveScamHint}
            showBridge={bridgeUnlocked && !offPlatformAck}
            onContinueSafely={() => setOffPlatformAck(true)}
          />
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(it, i) => (it.kind === 'offer' ? `o_${it.offer.id}` : `m_${it.msg.id}`) + i}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            if (item.kind === 'msg') {
              const mine = item.msg.senderId === MOCK_ME;
              return (
                <View style={[styles.msgRow, mine ? styles.msgMine : styles.msgTheirs]}>
                  <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleTheirs]}>
                    <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.msg.text}</Text>
                  </View>
                </View>
              );
            }
            const o = item.offer;
            const mine = o.buyerId === MOCK_ME;
            // The counterparty (seller, when I'm buying) can act on my pending offer.
            // In this buyer-centric demo, the "act" affordance appears for seller role.
            const canAct = thread.myRole === 'seller';
            return (
              <OfferBubble
                offer={o}
                mine={mine}
                canAct={canAct}
                busy={acceptOffer.isPending || counterOffer.isPending || declineOffer.isPending}
                onAccept={() => acceptOffer.mutate(o.id)}
                onDecline={() => declineOffer.mutate(o.id)}
                onCounter={() => setOfferSheet({ counterOf: o.id })}
              />
            );
          }}
        />

        {/* ── Composer + Make Offer ── */}
        <View style={styles.composer}>
          <Pressable style={styles.offerBtn} onPress={() => setOfferSheet('make')} accessibilityLabel="Make an offer">
            <HandCoins size={20} color={MarketColors.brand} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={MarketColors.muted}
            multiline
          />
          <Pressable style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]} onPress={handleSend} disabled={!draft.trim()}>
            <Send size={18} color={MarketColors.surface} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Make Offer (20) / Counter sheets — same component, prefilled at asking. */}
      <PriceOfferSheet
        visible={offerSheet === 'make'}
        title="Make an offer"
        askingPriceKobo={thread.listingPriceKobo}
        submitLabel="Send offer"
        withMessage
        submitting={createOffer.isPending}
        onClose={() => setOfferSheet(null)}
        onSubmit={(priceKobo, message) => {
          createOffer.mutate({ listingId, offerPriceKobo: priceKobo, message });
          setOfferSheet(null);
        }}
      />
      <PriceOfferSheet
        visible={typeof offerSheet === 'object' && offerSheet !== null}
        title="Counter offer"
        askingPriceKobo={thread.listingPriceKobo}
        submitLabel="Send counter"
        submitting={counterOffer.isPending}
        onClose={() => setOfferSheet(null)}
        onSubmit={(priceKobo) => {
          if (typeof offerSheet === 'object' && offerSheet) {
            counterOffer.mutate({ offerId: offerSheet.counterOf, priceKobo });
          }
          setOfferSheet(null);
        }}
      />

      {/* Meetup Mode (27) — modal so no extra route is needed under the Tabs shell. */}
      <MeetupModeSheet
        visible={meetupOpen}
        listingTitle={thread.listingTitle}
        dealId={thread.id}
        onClose={() => setMeetupOpen(false)}
      />
    </SafeAreaView>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
        <ArrowLeft size={22} color={Colors.onSurface} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  headerSub: { ...Typography.bodySm, color: MarketColors.muted },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm + 2, borderWidth: 1, borderColor: MarketColors.border },
  pinnedInfo: { flex: 1 },
  pinnedTitle: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '700' },
  pinnedPrice: { ...Typography.bodySm, color: MarketColors.muted, marginTop: 1 },
  meetupBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MarketColors.surface, borderWidth: 1.5, borderColor: MarketColors.brand, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  meetupBtnText: { ...Typography.labelMd, color: MarketColors.brand, fontWeight: '800' },
  bannerWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  thread: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: 2 },
  msgRow: { flexDirection: 'row', marginVertical: 2 },
  msgMine: { justifyContent: 'flex-end' },
  msgTheirs: { justifyContent: 'flex-start' },
  msgBubble: { maxWidth: '78%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  msgBubbleMine: { backgroundColor: MarketColors.brand, borderTopRightRadius: Radius.sm },
  msgBubbleTheirs: { backgroundColor: MarketColors.surfaceAlt, borderTopLeftRadius: Radius.sm },
  msgText: { ...Typography.bodyMd, color: MarketColors.text },
  msgTextMine: { color: MarketColors.surface },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  offerBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, maxHeight: 100, minHeight: 44, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingTop: 11, paddingBottom: 11, backgroundColor: MarketColors.surface },
  sendBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: MarketColors.brand, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
});
