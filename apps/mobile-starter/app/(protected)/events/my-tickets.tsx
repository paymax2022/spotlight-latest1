// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listMyTickets, transferTicket } from '@/api/events.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { formatCurrency } from '@/utils/format';
import type { MyTicket } from '@/api/events.api';

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
};

// ─── QR Code placeholder ─────────────────────────────────────────────────────
function QRPlaceholder({ code }: { code: string }) {
  return (
    <View style={styles.qrBox}>
      {/* Simplified QR visual — real impl would use a library like react-native-qrcode-svg */}
      <View style={styles.qrInner}>
        <Ionicons name="qr-code" size={100} color={C.primary} />
      </View>
      <Text style={styles.qrCode}>{code.slice(0, 12).toUpperCase()}</Text>
      <Text style={styles.qrHint}>Tap to enlarge</Text>
    </View>
  );
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────
function TicketCard({ ticket, onTransfer }: { ticket: MyTicket; onTransfer: (t: MyTicket) => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    valid:     { label: `Valid — Gate ${ticket.gate}`, color: C.teal, bg: C.teal + '18' },
    used:      { label: 'Used',      color: C.onSurfaceMuted, bg: C.surfaceContainer },
    cancelled: { label: 'Cancelled', color: '#ba1a1a',        bg: '#ffdad6' },
    expired:   { label: 'Expired',   color: C.onSurfaceMuted, bg: C.surfaceContainer },
  };
  const s = statusConfig[ticket.status] ?? statusConfig.valid;

  return (
    <View style={[styles.ticketCard, ticket.is_vip && styles.ticketCardVip]}>
      {/* VIP shimmer strip */}
      {ticket.is_vip && <View style={styles.vipStrip} />}

      {/* Header */}
      <View style={styles.ticketHeader}>
        <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: s.color }]} />
          <Text style={[styles.statusText, { color: s.color }]}>{s.label}</Text>
        </View>
        {ticket.is_vip && (
          <View style={styles.vipBadge}>
            <Ionicons name="ribbon" size={12} color={C.gold} />
            <Text style={styles.vipText}>VIP</Text>
          </View>
        )}
      </View>

      {/* Event info */}
      <View style={styles.ticketBody}>
        <View style={styles.ticketEventThumb}>
          <Ionicons name="musical-notes" size={24} color="rgba(255,255,255,0.3)" />
        </View>
        <View style={styles.ticketInfo}>
          <Text style={styles.ticketEventTitle} numberOfLines={2}>{ticket.event_title}</Text>
          <View style={styles.ticketMetaRow}>
            <Ionicons name="calendar-outline" size={12} color={C.onSurfaceMuted} />
            <Text style={styles.ticketMetaText}>
              {new Date(ticket.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })} · {ticket.time}
            </Text>
          </View>
          <View style={styles.ticketMetaRow}>
            <Ionicons name="ticket-outline" size={12} color={C.onSurfaceMuted} />
            <Text style={styles.ticketMetaText}>{ticket.tier_name} · {ticket.seat}</Text>
          </View>
        </View>
      </View>

      {/* Dashed divider */}
      <View style={styles.dashedDivider}>
        {Array.from({ length: 18 }).map((_, i) => (
          <View key={i} style={styles.dash} />
        ))}
      </View>

      {/* QR Code section */}
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.qrSection}>
        {expanded ? (
          <QRPlaceholder code={ticket.qr_code} />
        ) : (
          <View style={styles.qrCollapsed}>
            <Ionicons name="qr-code-outline" size={28} color={C.primaryContainer} />
            <Text style={styles.qrCollapsedText}>Tap to show QR code</Text>
          </View>
        )}
      </Pressable>

      {/* Actions */}
      {ticket.status === 'valid' && (
        <View style={styles.ticketActions}>
          <Pressable style={styles.actionBtn}>
            <Ionicons name="download-outline" size={16} color={C.secondary} />
            <Text style={styles.actionBtnText}>Save PDF</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => onTransfer(ticket)}>
            <Ionicons name="arrow-redo-outline" size={16} color={C.secondary} />
            <Text style={styles.actionBtnText}>Transfer</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Transfer Modal ───────────────────────────────────────────────────────────
function TransferModal({ ticket, onClose }: { ticket: MyTicket; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => transferTicket({ ticket_id: ticket.id, recipient_phone: phone.trim() }),
    onSuccess: () => setDone(true),
    onError: (err: any) => setError(err?.message ?? 'Transfer failed'),
  });

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {done ? (
            <View style={styles.modalDone}>
              <Ionicons name="checkmark-circle" size={56} color={C.teal} />
              <Text style={styles.modalDoneTitle}>Ticket Transferred!</Text>
              <Text style={styles.modalDoneSub}>The ticket has been sent to {phone}</Text>
              <Pressable style={styles.modalCloseBtn} onPress={onClose}>
                <Text style={styles.modalCloseBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Transfer Ticket</Text>
              <Text style={styles.modalSub}>
                Transfer your ticket for "{ticket.event_title}" to another Paymax user.
              </Text>

              <Text style={styles.fieldLabel}>Recipient Phone Number</Text>
              <View style={styles.inputBox}>
                <Ionicons name="call-outline" size={18} color={C.onSurfaceMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="+234 800 000 0000"
                  placeholderTextColor={C.onSurfaceMuted}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoFocus
                />
              </View>

              <View style={styles.warningBox}>
                <Ionicons name="information-circle-outline" size={16} color="#d97706" />
                <Text style={styles.warningText}>
                  Transfers are final and cannot be reversed. Available up to 48 hours before the event.
                </Text>
              </View>

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color="#ba1a1a" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.modalBtns}>
                <Pressable style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.transferBtn, mutation.isPending && { opacity: 0.6 }]}
                  disabled={mutation.isPending}
                  onPress={() => {
                    setError(null);
                    if (!phone.trim()) { setError('Phone number is required'); return; }
                    mutation.mutate();
                  }}
                >
                  {mutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.transferBtnText}>Transfer Ticket</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function MyTicketWalletScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming');
  const [transferTarget, setTransferTarget] = useState<MyTicket | null>(null);

  const query = useQuery({
    queryKey: ['my-tickets', filter],
    queryFn: () => listMyTickets(filter),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My Tickets</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Segmented Control */}
      <View style={styles.segmented}>
        {(['upcoming', 'past'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.segBtn, filter === tab && styles.segBtnActive]}
            onPress={() => setFilter(tab)}
          >
            <Text style={[styles.segBtnText, filter === tab && styles.segBtnTextActive]}>
              {tab === 'upcoming' ? 'Upcoming' : 'Past'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Ticket List */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.secondary}
          />
        }
      >
        {query.isLoading ? (
          <AppLoader />
        ) : (query.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="ticket-outline" size={56} color={C.outline} />
            <Text style={styles.emptyTitle}>
              {filter === 'upcoming' ? 'No Upcoming Tickets' : 'No Past Tickets'}
            </Text>
            <Text style={styles.emptyText}>
              {filter === 'upcoming'
                ? 'Discover events and buy tickets to see them here.'
                : 'Tickets for events you attended will appear here.'}
            </Text>
            {filter === 'upcoming' && (
              <Pressable style={styles.browseBtn} onPress={() => router.push('/events' as never)}>
                <Text style={styles.browseBtnText}>Browse Events</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            {(query.data ?? []).map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onTransfer={setTransferTarget}
              />
            ))}

            {/* Elite perk banner (shown if any VIP ticket) */}
            {(query.data ?? []).some((t) => t.is_vip && t.status === 'valid') && (
              <View style={styles.eliteBanner}>
                <View style={styles.eliteBannerLeft}>
                  <View style={styles.eliteIconBox}>
                    <Ionicons name="ribbon" size={22} color={C.gold} />
                  </View>
                  <View>
                    <Text style={styles.eliteBannerTitle}>Elite Connectivity</Text>
                    <Text style={styles.eliteBannerSub}>
                      Your VIP access grants you 15% off at the festival's digital lounge
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.gold} />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Transfer Modal */}
      {transferTarget && (
        <TransferModal
          ticket={transferTarget}
          onClose={() => setTransferTarget(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.outlineVariant,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.surfaceContainer, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.onSurface },

  // Segmented
  segmented: {
    flexDirection: 'row', marginHorizontal: 20, marginTop: 16,
    backgroundColor: C.surfaceContainer, borderRadius: 12, padding: 4,
  },
  segBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
  },
  segBtnActive: { backgroundColor: C.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  segBtnText: { fontSize: 14, fontWeight: '600', color: C.onSurfaceMuted },
  segBtnTextActive: { color: C.primary },

  // List
  list: { padding: 20, gap: 20, paddingBottom: 40 },

  // Ticket Card
  ticketCard: {
    backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: C.outlineVariant,
    shadowColor: C.primaryContainer,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3,
  },
  ticketCardVip: {
    borderColor: C.gold + '40',
    shadowColor: C.gold,
  },
  vipStrip: { height: 4, backgroundColor: C.gold, width: '100%' },
  ticketHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  vipBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.gold + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999,
    borderWidth: 1, borderColor: C.gold + '40',
  },
  vipText: { fontSize: 11, fontWeight: '800', color: C.gold },

  // Ticket body
  ticketBody: {
    flexDirection: 'row', gap: 14,
    paddingHorizontal: 16, paddingBottom: 16,
  },
  ticketEventThumb: {
    width: 72, height: 72, borderRadius: 12,
    backgroundColor: C.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  ticketInfo: { flex: 1 },
  ticketEventTitle: { fontSize: 15, fontWeight: '700', color: C.onSurface, marginBottom: 6, lineHeight: 21 },
  ticketMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  ticketMetaText: { fontSize: 12, color: C.onSurfaceMuted },

  // Dashed divider
  dashedDivider: {
    flexDirection: 'row', marginHorizontal: 16, marginVertical: 0,
    justifyContent: 'space-between',
  },
  dash: { width: 6, height: 1.5, backgroundColor: C.outlineVariant, borderRadius: 1 },

  // QR Section
  qrSection: { paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center' },
  qrBox: { alignItems: 'center', gap: 8 },
  qrInner: {
    width: 160, height: 160, borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  qrCode: { fontSize: 13, fontFamily: 'monospace', fontWeight: '700', color: C.primary, letterSpacing: 1 },
  qrHint: { fontSize: 11, color: C.onSurfaceMuted },
  qrCollapsed: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surfaceContainer, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    width: '100%', justifyContent: 'center',
  },
  qrCollapsedText: { fontSize: 14, fontWeight: '600', color: C.primaryContainer },

  // Actions
  ticketActions: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.outlineVariant,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: C.secondary },

  // Elite Banner
  eliteBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.primary, borderRadius: 16, padding: 16, gap: 12,
  },
  eliteBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  eliteIconBox: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.gold + '20', alignItems: 'center', justifyContent: 'center',
  },
  eliteBannerTitle: { fontSize: 14, fontWeight: '800', color: C.gold, marginBottom: 4 },
  eliteBannerSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 17, flex: 1 },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 64, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.onSurface },
  emptyText: { fontSize: 14, color: C.onSurfaceMuted, textAlign: 'center', lineHeight: 20 },
  browseBtn: {
    marginTop: 8, backgroundColor: C.primaryContainer,
    borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13,
  },
  browseBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Transfer Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingTop: 12, gap: 14,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.outline, alignSelf: 'center', marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.onSurface },
  modalSub: { fontSize: 14, color: C.onSurfaceMuted, lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.onSurface },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F1F5F9', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1.5, borderColor: C.outlineVariant,
  },
  input: { flex: 1, fontSize: 15, color: C.onSurface },
  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFFBEB', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#FCD34D',
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#ffdad6', padding: 10, borderRadius: 10,
  },
  errorText: { color: '#ba1a1a', fontSize: 13, flex: 1 },
  modalBtns: { flexDirection: 'row', gap: 12, paddingBottom: 8 },
  cancelBtn: {
    flex: 1, height: 52, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: C.onSurfaceMuted },
  transferBtn: {
    flex: 2, height: 52, borderRadius: 14,
    backgroundColor: C.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  transferBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalDone: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  modalDoneTitle: { fontSize: 20, fontWeight: '800', color: C.onSurface },
  modalDoneSub: { fontSize: 14, color: C.onSurfaceMuted },
  modalCloseBtn: {
    marginTop: 12, backgroundColor: C.primaryContainer, borderRadius: 14,
    paddingHorizontal: 32, paddingVertical: 13,
  },
  modalCloseBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
