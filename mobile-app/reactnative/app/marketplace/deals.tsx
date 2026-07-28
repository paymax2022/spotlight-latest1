// ── Screen 18 — Chat inbox (Chat/Deals tab) ──────────────────────────────────
// Conversation list with listing-thumbnail context + a deal-stage chip per row,
// so a buyer/seller can read where a deal stands without opening it. The stage is
// DERIVED: if a thread has an order, from the order's FSM status; otherwise from
// its live offers (offer pending / accepted) or plain chatting.
//
// No dedicated Paymax messaging shell exists for the marketplace yet, so threads
// are modelled around their listing + offers (see offers.mock.ts). TODO(messaging)
// noted there — swap in the shared shell when it lands without touching this UI.
import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import { useThreads, useOffers } from '@/features/marketplace/api/transact.hooks';
import type { DealThread } from '@/features/marketplace/api/offers.api';
import { DealStageChip } from './_components/DealStageChip';
import SafetyStrip from './_components/SafetyStrip';
import { type DealStage } from './_components/transact.constants';

function ThreadRow({ thread }: { thread: DealThread }) {
  // Derive the deal stage from the latest offer on the listing; else chatting.
  const offersQ = useOffers(thread.listingId);

  let stage: DealStage = 'chatting';
  if (offersQ.data && offersQ.data.length > 0) {
    const latest = offersQ.data[offersQ.data.length - 1];
    stage = latest.status === 'accepted' ? 'offer_accepted' : latest.status === 'pending' || latest.status === 'countered' ? 'offer_pending' : 'chatting';
  }

  return (
    <Pressable style={styles.row} onPress={() => router.push(`/marketplace/deals/${thread.id}` as never)}>
      <View style={styles.thumb}>
        {thread.listingThumbUrl ? (
          <Image source={{ uri: thread.listingThumbUrl }} style={styles.thumbImg} />
        ) : (
          <Package size={22} color={MarketColors.muted} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>{thread.counterpartyName}</Text>
          {thread.unread > 0 ? (
            <View style={styles.unread}><Text style={styles.unreadText}>{thread.unread}</Text></View>
          ) : null}
        </View>
        <Text style={styles.listing} numberOfLines={1}>{thread.listingTitle}</Text>
        <View style={styles.metaLine}>
          <DealStageChip stage={stage} />
          <Text style={styles.price}>{formatNaira(thread.listingPriceKobo)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatInbox() {
  const threadsQ = useThreads();
  const threads = threadsQ.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats & deals</Text>
      </View>
      <View style={styles.stripWrap}><SafetyStrip /></View>

      {threadsQ.isLoading ? (
        <StateView kind="loading" message="Loading conversations…" />
      ) : threadsQ.isError ? (
        <StateView kind="error" title="Couldn't load chats" actionLabel="Retry" onAction={() => threadsQ.refetch()} />
      ) : threads.length === 0 ? (
        <StateView
          kind="empty"
          icon="MessagesSquare"
          title="No conversations yet"
          message="Message a seller from any listing to start negotiating safely."
        />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ThreadRow thread={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  stripWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xl },
  row: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm + 2 },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name: { ...Typography.titleMd, color: MarketColors.text, flex: 1 },
  unread: { minWidth: 20, height: 20, borderRadius: Radius.full, backgroundColor: MarketColors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { ...Typography.labelSm, color: MarketColors.surface, fontWeight: '800' },
  listing: { ...Typography.bodySm, color: MarketColors.muted, marginTop: 1 },
  metaLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  price: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '700' },
});
