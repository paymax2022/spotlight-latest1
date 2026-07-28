// ── Screen 34 — Help & Support Center ────────────────────────────────────────
// Self-serve resolution before escalating. Searchable FAQ (escrow / dispute /
// fee explainers — static content) + "Contact support" that PRE-ATTACHES context
// (an active order/listing, if the screen was opened from one) rather than a blank
// form, then routes into the existing Paymax support surface.
//
// Entry (optional route params): ?orderId=<id>&listingId=<id>
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, ChevronDown, ChevronUp, LifeBuoy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { MarketColors } from '@/features/marketplace';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface FaqItem { q: string; a: string; tags: string[] }

const FAQ: FaqItem[] = [
  {
    q: 'How does escrow protect my money?',
    a: 'When you fund an order, Paymax holds the money in escrow — the seller does not get it yet. The seller is only paid after you confirm the item was received in good condition, or after the 48-hour inspection window passes with no dispute. If something is wrong, open a dispute before confirming and your money stays protected while we review.',
    tags: ['escrow', 'money', 'protection', 'hold', 'inspection'],
  },
  {
    q: 'What fees will I pay?',
    a: 'You see a full, itemised breakdown at checkout before you pay: the item price, the escrow fee (a small percentage of the item price), and a delivery fee only if you choose rider delivery. There are no hidden fees — pickup deals have no delivery fee.',
    tags: ['fee', 'fees', 'charge', 'cost', 'escrow fee', 'delivery'],
  },
  {
    q: 'How do I open a dispute?',
    a: 'From the order, tap "Report a problem" while the order is still in delivery or the inspection window. Pick a reason, add evidence (photos or chat excerpts), and submit. An agent reviews the evidence from both sides and decides: refund to you, release to the seller, or a split. Large orders require two approvers before any payout.',
    tags: ['dispute', 'problem', 'refund', 'evidence', 'resolution'],
  },
  {
    q: 'When is the seller paid?',
    a: 'After you confirm delivery, or automatically when the 48-hour inspection window ends with no open dispute. Every escrow order resolves to exactly one outcome — released, refunded, resolved after a dispute, or cancelled before funding — so money never gets stuck.',
    tags: ['release', 'paid', 'seller', 'inspection', 'auto release'],
  },
  {
    q: 'Is a cash / meetup deal covered by escrow?',
    a: 'No. Meetup (cash) deals are not covered by Paymax buyer protection. Use Meetup Mode’s verified safe-spots, trip-share and check-in for safety, but only escrow-funded orders carry the money-back guarantee.',
    tags: ['meetup', 'cash', 'safe spot', 'safety', 'protection'],
  },
  {
    q: 'How do I raise my trust badge?',
    a: 'Complete verification in the Verification Center (Account tab). Higher KYC tiers unlock higher listing limits and upgraded badges shown on your seller profile and listings. Your badge is earned through verification only — it is never boost-gated.',
    tags: ['trust', 'badge', 'verification', 'kyc', 'tier', 'limit'],
  },
];

export default function HelpCenter() {
  const params = useLocalSearchParams<{ orderId?: string; listingId?: string }>();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ;
    return FAQ.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q) || f.tags.some((t) => t.includes(q)));
  }, [query]);

  const toggle = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === i ? null : i));
  };

  const contextLabel = params.orderId ? `order ${params.orderId.slice(0, 8)}` : params.listingId ? `listing ${params.listingId.slice(0, 8)}` : null;

  const contactSupport = () => {
    // Route into the existing Paymax support surface, pre-attaching context so the
    // agent starts with the order/listing already in view (not a blank form).
    router.push({
      pathname: '/voting/support' as never,
      params: {
        source: 'marketplace',
        ...(params.orderId ? { orderId: params.orderId } : {}),
        ...(params.listingId ? { listingId: params.listingId } : {}),
      } as never,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Help & support" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.searchBar}>
          <Search size={18} color={MarketColors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search help (escrow, fees, disputes…)"
            placeholderTextColor={MarketColors.muted}
            returnKeyType="search"
          />
        </View>

        {results.length === 0 ? (
          <StateView
            kind="empty"
            icon="Search"
            title="No matching answers"
            message="Try a different word, or contact support and we’ll help you directly."
            compact
          />
        ) : (
          <View style={styles.faqList}>
            {results.map((f, i) => {
              const isOpen = open === i;
              return (
                <Pressable key={f.q} style={styles.faqItem} onPress={() => toggle(i)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                  <View style={styles.faqHead}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    {isOpen ? <ChevronUp size={18} color={MarketColors.muted} /> : <ChevronDown size={18} color={MarketColors.muted} />}
                  </View>
                  {isOpen ? <Text style={styles.faqA}>{f.a}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.contactCard}>
          <View style={styles.contactHead}>
            <LifeBuoy size={20} color={MarketColors.brand} />
            <Text style={styles.contactTitle}>Still need help?</Text>
          </View>
          <Text style={styles.contactSub}>
            {contextLabel ? `We’ll attach ${contextLabel} to your request so you don’t have to explain from scratch.` : 'Reach our support team — we’ll pick up from wherever you are.'}
          </Text>
          <PrimaryButton label="Contact support" onPress={contactSupport} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  searchInput: { flex: 1, paddingVertical: Spacing.sm, ...Typography.bodyMd, color: MarketColors.text },
  faqList: { gap: Spacing.sm },
  faqItem: { padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  faqQ: { ...Typography.titleMd, color: MarketColors.text, flex: 1 },
  faqA: { ...Typography.bodyMd, color: MarketColors.muted, marginTop: Spacing.sm, lineHeight: 20 },
  contactCard: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surfaceAlt, gap: Spacing.sm },
  contactHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  contactTitle: { ...Typography.titleMd, color: MarketColors.text },
  contactSub: { ...Typography.bodyMd, color: MarketColors.muted },
});
