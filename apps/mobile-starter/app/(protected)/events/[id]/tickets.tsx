// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getEvent, listEventTicketTiers, purchaseTickets } from '@/api/events.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { formatCurrency } from '@/utils/format';
import type { TicketTier } from '@/api/events.api';

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  primary: '#1a0042',
  primaryContainer: '#340075',
  secondary: '#0051d5',
  teal: '#48b8ac',
  gold: '#d4af37',
  bg: '#f8f9ff',
  surface: '#ffffff',
  surfaceContainer: '#eceef3',
  onSurface: '#191c20',
  onSurfaceMuted: '#4a4451',
  outline: '#ccc3d3',
  outlineVariant: '#F1F5F9',
  error: '#ba1a1a',
};

type Selection = Record<string, number>; // tier_id → quantity

// ─── Ticket Tier Card ─────────────────────────────────────────────────────────

function TierCard({
  tier,
  qty,
  onAdd,
  onRemove,
}: {
  tier: TicketTier;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const soldOut = tier.available === 0;
  const pctLeft = tier.total > 0 ? (tier.available / tier.total) * 100 : 0;
  const isLow = !soldOut && pctLeft <= 20;

  return (
    <View style={[styles.tierCard, soldOut && styles.tierCardDimmed, qty > 0 && styles.tierCardSelected]}>
      {/* Tier header */}
      <View style={styles.tierHeader}>
        <View style={styles.tierLeft}>
          <View style={styles.tierNameRow}>
            <Text style={styles.tierName}>{tier.name}</Text>
            {tier.is_popular && (
              <View style={styles.popularBadge}>
                <Text style={styles.popularText}>POPULAR</Text>
              </View>
            )}
            {soldOut && (
              <View style={styles.soldOutBadge}>
                <Text style={styles.soldOutText}>SOLD OUT</Text>
              </View>
            )}
          </View>
          {tier.description ? (
            <Text style={styles.tierDesc}>{tier.description}</Text>
          ) : null}
          {tier.perks?.length > 0 && (
            <View style={styles.perksRow}>
              {tier.perks.slice(0, 2).map((p, i) => (
                <View key={i} style={styles.perkChip}>
                  <Ionicons name="checkmark" size={10} color={C.teal} />
                  <Text style={styles.perkText}>{p}</Text>
                </View>
              ))}
            </View>
          )}
          {!soldOut && (
            <View style={styles.availRow}>
              {isLow ? (
                <View style={styles.lowStock}>
                  <Ionicons name="flame" size={11} color="#FF6B35" />
                  <Text style={styles.lowStockText}>{tier.available} Remaining</Text>
                </View>
              ) : (
                <Text style={styles.availText}>{tier.available} Remaining</Text>
              )}
            </View>
          )}
        </View>
        <View style={styles.tierRight}>
          <Text style={styles.tierPrice}>{formatCurrency(tier.price_kobo, 'NGN')}</Text>
          {!soldOut && (
            <View style={styles.qtyControls}>
              <Pressable
                style={[styles.qtyBtn, qty === 0 && styles.qtyBtnDisabled]}
                onPress={onRemove}
                disabled={qty === 0}
              >
                <Ionicons name="remove" size={16} color={qty === 0 ? C.outline : C.primaryContainer} />
              </Pressable>
              <Text style={[styles.qtyValue, qty > 0 && styles.qtyValueActive]}>{qty}</Text>
              <Pressable style={styles.qtyBtn} onPress={onAdd}>
                <Ionicons name="add" size={16} color={C.primaryContainer} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SelectTicketsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>({});
  const [error, setError] = useState<string | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<{ reference: string; amount_kobo: number } | null>(null);

  const eventQuery = useQuery({ queryKey: ['event-detail', id], queryFn: () => getEvent(id) });
  const tiersQuery = useQuery({ queryKey: ['event-tiers', id], queryFn: () => listEventTicketTiers(id) });

  const mutation = useMutation({
    mutationFn: () =>
      purchaseTickets({
        event_id: id,
        selections: Object.entries(selection)
          .filter(([, qty]) => qty > 0)
          .map(([tier_id, quantity]) => ({ tier_id, quantity })),
      }),
    onSuccess: (result) => setPurchaseResult(result),
    onError: (err: any) => setError(err?.message ?? 'Purchase failed. Please try again.'),
  });

  if (eventQuery.isLoading || tiersQuery.isLoading) return <AppLoader />;

  const event = eventQuery.data;
  const tiers = tiersQuery.data ?? [];

  // Totals
  const totalTickets = Object.values(selection).reduce((s, q) => s + q, 0);
  const subtotalKobo = tiers.reduce((s, tier) => s + (selection[tier.id] ?? 0) * tier.price_kobo, 0);
  const serviceFeeKobo = totalTickets > 0 ? Math.round(subtotalKobo * 0.05) : 0;
  const totalKobo = subtotalKobo + serviceFeeKobo;

  function add(tierId: string) {
    setSelection((prev) => ({ ...prev, [tierId]: (prev[tierId] ?? 0) + 1 }));
  }
  function remove(tierId: string) {
    setSelection((prev) => {
      const next = (prev[tierId] ?? 0) - 1;
      if (next <= 0) {
        const { [tierId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [tierId]: next };
    });
  }

  // ─── Success state ────────────────────────────────────────────────────────
  if (purchaseResult) {
    return (
      <SafeAreaView style={[styles.safe, styles.successContainer]}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={80} color={C.teal} />
        </View>
        <Text style={styles.successTitle}>Tickets Confirmed!</Text>
        <Text style={styles.successSub}>
          {totalTickets} ticket{totalTickets !== 1 ? 's' : ''} for {event?.title}
        </Text>
        <View style={styles.successRef}>
          <Text style={styles.successRefLabel}>Booking Reference</Text>
          <Text style={styles.successRefValue}>{purchaseResult.reference.slice(0, 12).toUpperCase()}</Text>
        </View>
        <Text style={styles.successAmount}>{formatCurrency(purchaseResult.amount_kobo, 'NGN')}</Text>
        <View style={styles.successActions}>
          <Pressable
            style={styles.viewTicketBtn}
            onPress={() => router.replace('/events/my-tickets' as never)}
          >
            <Ionicons name="ticket-outline" size={18} color="#fff" />
            <Text style={styles.viewTicketBtnText}>View My Tickets</Text>
          </Pressable>
          <Pressable style={styles.homeBtn} onPress={() => router.replace('/(tabs)/index' as never)}>
            <Text style={styles.homeBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Header */}
      <SafeAreaView style={styles.header} edges={['top']}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Select Tickets</Text>
          {event && <Text style={styles.headerSub} numberOfLines={1}>{event.title}</Text>}
        </View>
      </SafeAreaView>

      {/* Event summary chip */}
      {event && (
        <View style={styles.eventChip}>
          <View style={styles.liveChip}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE EVENT</Text>
          </View>
          <Text style={styles.eventChipTitle} numberOfLines={1}>{event.title}</Text>
          <View style={styles.eventChipMeta}>
            <Ionicons name="calendar-outline" size={12} color={C.onSurfaceMuted} />
            <Text style={styles.eventChipMetaText}>
              {new Date(event.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={styles.eventChipDot}>·</Text>
            <Ionicons name="location-outline" size={12} color={C.onSurfaceMuted} />
            <Text style={styles.eventChipMetaText} numberOfLines={1}>{event.venue}</Text>
          </View>
        </View>
      )}

      {/* Tier List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {tiers.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="ticket-outline" size={48} color={C.outline} />
            <Text style={styles.emptyText}>No tickets available</Text>
          </View>
        ) : (
          tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              qty={selection[tier.id] ?? 0}
              onAdd={() => add(tier.id)}
              onRemove={() => remove(tier.id)}
            />
          ))
        )}

        {/* Trust row */}
        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color={C.teal} />
          <Text style={styles.trustText}>Secure Payment</Text>
          <View style={styles.trustDot} />
          <Text style={styles.trustText}>No Resale Fees</Text>
        </View>
      </ScrollView>

      {/* Order summary footer */}
      <View style={styles.footer}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryLeft}>
            <Text style={styles.summaryCount}>
              {totalTickets === 0 ? '0 Tickets Selected' : `${totalTickets} Ticket${totalTickets !== 1 ? 's' : ''} Selected`}
            </Text>
            {totalTickets > 0 && (
              <View style={styles.feeRow}>
                <Text style={styles.feeText}>{formatCurrency(subtotalKobo, 'NGN')}</Text>
                <Text style={styles.feeLabel}> + {formatCurrency(serviceFeeKobo, 'NGN')} fee</Text>
              </View>
            )}
          </View>
          <Text style={styles.summaryTotal}>
            {totalKobo === 0 ? '₦0.00' : formatCurrency(totalKobo, 'NGN')}
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={15} color={C.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.footerBtns}>
          {totalTickets > 0 && (
            <Pressable style={styles.clearBtn} onPress={() => setSelection({})}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.checkoutBtn,
              totalTickets === 0 && styles.checkoutBtnDisabled,
              mutation.isPending && styles.checkoutBtnDisabled,
            ]}
            disabled={totalTickets === 0 || mutation.isPending}
            onPress={() => { setError(null); mutation.mutate(); }}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.checkoutBtnText}>Proceed to Checkout</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  successContainer: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 26, fontWeight: '800', color: C.onSurface, marginBottom: 6 },
  successSub: { fontSize: 15, color: C.onSurfaceMuted, textAlign: 'center', marginBottom: 24 },
  successRef: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', width: '100%', marginBottom: 12,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  successRefLabel: { fontSize: 11, color: C.onSurfaceMuted, fontWeight: '600', marginBottom: 4 },
  successRefValue: { fontSize: 18, fontWeight: '800', color: C.primary, fontFamily: 'monospace' },
  successAmount: { fontSize: 28, fontWeight: '900', color: C.primaryContainer, marginBottom: 32 },
  successActions: { width: '100%', gap: 12 },
  viewTicketBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryContainer, borderRadius: 16, height: 56,
  },
  viewTicketBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  homeBtn: {
    alignItems: 'center', justifyContent: 'center', height: 48,
    borderWidth: 1.5, borderColor: C.outline, borderRadius: 14,
  },
  homeBtnText: { color: C.onSurface, fontWeight: '600', fontSize: 15 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingBottom: 14, paddingTop: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.outlineVariant,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.surfaceContainer, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.onSurface },
  headerSub: { fontSize: 12, color: C.onSurfaceMuted, marginTop: 1 },

  // Event Chip
  eventChip: {
    marginHorizontal: 20, marginTop: 14,
    backgroundColor: C.primaryContainer,
    borderRadius: 14, padding: 14,
  },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal },
  liveText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  eventChipTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  eventChipMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eventChipMetaText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1 },
  eventChipDot: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },

  // List
  list: { padding: 20, gap: 14, paddingBottom: 200 },

  // Tier Card
  tierCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: C.outlineVariant,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2,
  },
  tierCardDimmed: { opacity: 0.55 },
  tierCardSelected: { borderColor: C.secondary + '60', backgroundColor: '#F0F4FF' },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  tierLeft: { flex: 1 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  tierName: { fontSize: 15, fontWeight: '700', color: C.onSurface },
  popularBadge: {
    backgroundColor: C.secondary + '18', borderRadius: 9999,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: C.secondary + '40',
  },
  popularText: { fontSize: 9, fontWeight: '800', color: C.secondary, letterSpacing: 0.5 },
  soldOutBadge: {
    backgroundColor: '#f3f4f6', borderRadius: 9999,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  soldOutText: { fontSize: 9, fontWeight: '800', color: '#6b7280', letterSpacing: 0.5 },
  tierDesc: { fontSize: 12, color: C.onSurfaceMuted, marginBottom: 8, lineHeight: 17 },
  perksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  perkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.teal + '12', borderRadius: 9999,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  perkText: { fontSize: 11, color: C.teal, fontWeight: '600' },
  availRow: { marginTop: 2 },
  availText: { fontSize: 12, color: C.onSurfaceMuted },
  lowStock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lowStockText: { fontSize: 12, color: '#FF6B35', fontWeight: '600' },
  tierRight: { alignItems: 'flex-end', gap: 10 },
  tierPrice: { fontSize: 16, fontWeight: '800', color: C.primaryContainer },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1.5, borderColor: C.primaryContainer + '50',
    backgroundColor: '#F0E8FF',
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnDisabled: { borderColor: C.outline, backgroundColor: C.surfaceContainer },
  qtyValue: { fontSize: 16, fontWeight: '700', color: C.onSurface, minWidth: 20, textAlign: 'center' },
  qtyValueActive: { color: C.primaryContainer },

  // Trust
  trustRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 8,
  },
  trustText: { fontSize: 12, color: C.onSurfaceMuted, fontWeight: '500' },
  trustDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.outline },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 15, color: C.onSurfaceMuted },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.outlineVariant,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.07, shadowRadius: 14,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  summaryLeft: {},
  summaryCount: { fontSize: 13, fontWeight: '600', color: C.onSurface },
  feeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  feeText: { fontSize: 13, fontWeight: '700', color: C.primaryContainer },
  feeLabel: { fontSize: 12, color: C.onSurfaceMuted },
  summaryTotal: { fontSize: 20, fontWeight: '800', color: C.primary },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 10, borderRadius: 10, marginBottom: 10,
  },
  errorText: { color: C.error, fontSize: 13, flex: 1 },
  footerBtns: { flexDirection: 'row', gap: 10 },
  clearBtn: {
    paddingHorizontal: 18, height: 52, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  clearBtnText: { fontSize: 14, fontWeight: '600', color: C.onSurfaceMuted },
  checkoutBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryContainer, borderRadius: 14, height: 52,
    shadowColor: C.primaryContainer, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
  },
  checkoutBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  checkoutBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
