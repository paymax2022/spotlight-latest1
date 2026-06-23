// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getEvent } from '@/api/events.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { formatCurrency } from '@/utils/format';

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

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ icon, text, action }: { icon: string; text: string; action?: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconBox}>
        <Ionicons name={icon as never} size={18} color={C.secondary} />
      </View>
      <Text style={styles.infoText} numberOfLines={2}>{text}</Text>
      {action && (
        <View style={styles.infoAction}>
          <Text style={styles.infoActionText}>{action}</Text>
          <Ionicons name="open-outline" size={13} color={C.secondary} />
        </View>
      )}
    </View>
  );
}

function ArtistChip({ name }: { name: string }) {
  return (
    <View style={styles.artistChip}>
      <View style={styles.artistAvatar}>
        <Ionicons name="person" size={18} color={C.primary} />
      </View>
      <Text style={styles.artistName} numberOfLines={1}>{name}</Text>
    </View>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      style={[styles.faqItem, open && styles.faqItemOpen]}
      onPress={() => setOpen((v) => !v)}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQ}>{question}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={C.onSurfaceMuted}
        />
      </View>
      {open && <Text style={styles.faqA}>{answer}</Text>}
    </Pressable>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);

  const query = useQuery({
    queryKey: ['event-detail', id],
    queryFn: () => getEvent(id),
  });

  if (query.isLoading) return <AppLoader />;
  if (!query.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>Event not found</Text>
          <Pressable style={styles.errorBtn} onPress={() => router.back()}>
            <Text style={styles.errorBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const event = query.data;
  const formattedDate = new Date(event.date).toLocaleDateString('en-NG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroBg}>
          <View style={styles.heroGlow1} />
          <View style={styles.heroGlow2} />
        </View>

        {/* Floating header controls */}
        <SafeAreaView style={styles.heroNav} edges={['top']}>
          <Pressable style={styles.heroNavBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.heroNavRight}>
            <Pressable style={styles.heroNavBtn} onPress={() => setFavorited((v) => !v)}>
              <Ionicons name={favorited ? 'heart' : 'heart-outline'} size={20} color={favorited ? '#ff4d6d' : '#fff'} />
            </Pressable>
            <Pressable style={styles.heroNavBtn}>
              <Ionicons name="share-outline" size={20} color="#fff" />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Hero content */}
        <View style={styles.heroContent}>
          <View style={styles.heroStatusRow}>
            <View style={styles.confirmedBadge}>
              <Ionicons name="checkmark-circle" size={13} color={C.teal} />
              <Text style={styles.confirmedText}>Confirmed</Text>
            </View>
            <Text style={styles.heroCategoryText}>{event.category?.toUpperCase()}</Text>
          </View>
          <Text style={styles.heroTitle}>{event.title}</Text>
          <View style={styles.heroOrganizerRow}>
            <Text style={styles.heroOrganizer}>by {event.organizer}</Text>
            {query.data.organizer_verified && (
              <View style={styles.eliteBadge}>
                <Ionicons name="shield-checkmark" size={11} color={C.gold} />
                <Text style={styles.eliteBadgeText}>ELITE PARTNER</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>

        {/* Key Details */}
        <View style={styles.detailCard}>
          <InfoRow icon="calendar-outline" text={`${formattedDate} · ${event.start_time ?? ''}`} />
          <View style={styles.divider} />
          <InfoRow icon="location-outline" text={event.venue} action="Get Directions" />
        </View>

        {/* About */}
        {(event.about || event.description) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About the Event</Text>
            <Text style={styles.aboutText}>{event.about ?? event.description}</Text>
          </View>
        ) : null}

        {/* Artist Lineup */}
        {event.artists?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Artist Lineup</Text>
              <Text style={styles.seeAll}>View All</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.artistRow}>
              {event.artists.map((a) => (
                <ArtistChip key={a.id} name={a.name} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* FAQs */}
        {event.faqs?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FAQ</Text>
            <View style={styles.faqList}>
              {event.faqs.map((faq, i) => (
                <FAQItem key={i} question={faq.question} answer={faq.answer} />
              ))}
            </View>
          </View>
        )}

        {/* Trust */}
        <View style={styles.trustRow}>
          <View style={styles.trustItem}>
            <Ionicons name="shield-checkmark-outline" size={18} color={C.teal} />
            <Text style={styles.trustText}>Secure Entry{'\n'}Digital ID Check</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <Ionicons name="ribbon-outline" size={18} color={C.gold} />
            <Text style={styles.trustText}>Verified Org{'\n'}Elite Partner</Text>
          </View>
        </View>

        {/* Available tickets count */}
        {event.available_seats != null && event.available_seats < 50 && (
          <View style={styles.urgencyBanner}>
            <Ionicons name="flame" size={16} color="#FF6B35" />
            <Text style={styles.urgencyText}>
              Only <Text style={{ fontWeight: '800' }}>{event.available_seats}</Text> tickets remaining — act fast!
            </Text>
          </View>
        )}

        {/* Spacer for sticky footer */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky CTA Footer */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerFromLabel}>Starting from</Text>
          <Text style={styles.footerPrice}>
            {event.ticket_price_kobo === 0 ? 'FREE' : formatCurrency(event.ticket_price_kobo, 'NGN')}
          </Text>
        </View>
        <Pressable
          style={styles.buyBtn}
          onPress={() => router.push(`/events/${id}/tickets` as never)}
        >
          <Ionicons name="ticket-outline" size={18} color="#fff" />
          <Text style={styles.buyBtnText}>Buy Tickets</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errorText: { fontSize: 16, color: C.onSurfaceMuted },
  errorBtn: { backgroundColor: C.primaryContainer, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  errorBtnText: { color: '#fff', fontWeight: '700' },

  // Hero
  hero: { height: 240, position: 'relative', overflow: 'hidden' },
  heroBg: { ...StyleSheet.absoluteFillObject, backgroundColor: C.primary },
  heroGlow1: {
    position: 'absolute', top: -80, right: -80,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: C.secondary, opacity: 0.3,
  },
  heroGlow2: {
    position: 'absolute', bottom: -60, left: -60,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: C.teal, opacity: 0.2,
  },
  heroNav: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8,
    zIndex: 10,
  },
  heroNavRight: { flexDirection: 'row', gap: 10 },
  heroNavBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroContent: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 20, paddingBottom: 24,
    backgroundColor: 'linear-gradient(transparent, rgba(26,0,66,0.85))',
  },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  confirmedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.teal + '25', borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: C.teal + '40',
  },
  confirmedText: { fontSize: 11, fontWeight: '700', color: C.teal },
  heroCategoryText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', lineHeight: 30, marginBottom: 6 },
  heroOrganizerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroOrganizer: { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  eliteBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.gold + '20', borderRadius: 9999,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.gold + '40',
  },
  eliteBadgeText: { fontSize: 9, fontWeight: '800', color: C.gold, letterSpacing: 0.8 },

  // Body
  body: { paddingHorizontal: 20, paddingTop: 20 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.onSurface, marginBottom: 12 },
  seeAll: { fontSize: 13, fontWeight: '600', color: C.secondary },
  divider: { height: 1, backgroundColor: C.outlineVariant, marginVertical: 2 },

  // Detail card
  detailCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    marginBottom: 24,
    shadowColor: C.primaryContainer,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  infoIconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.secondary + '12', alignItems: 'center', justifyContent: 'center',
  },
  infoText: { flex: 1, fontSize: 14, color: C.onSurface, fontWeight: '500', lineHeight: 20 },
  infoAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoActionText: { fontSize: 13, fontWeight: '600', color: C.secondary },

  // About
  aboutText: { fontSize: 15, color: C.onSurfaceMuted, lineHeight: 24 },

  // Artists
  artistRow: { gap: 12, paddingRight: 20 },
  artistChip: {
    alignItems: 'center', gap: 8, width: 72,
  },
  artistAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primaryContainer + '18',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.primaryContainer + '30',
  },
  artistName: { fontSize: 12, fontWeight: '600', color: C.onSurface, textAlign: 'center' },

  // FAQs
  faqList: { gap: 8 },
  faqItem: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  faqItemOpen: { borderColor: C.secondary + '40' },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faqQ: { fontSize: 14, fontWeight: '600', color: C.onSurface, flex: 1, paddingRight: 8 },
  faqA: { fontSize: 13, color: C.onSurfaceMuted, marginTop: 10, lineHeight: 20 },

  // Trust
  trustRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  trustItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  trustText: { fontSize: 12, color: C.onSurfaceMuted, lineHeight: 17 },
  trustDivider: { width: 1, height: 32, backgroundColor: C.outlineVariant, marginHorizontal: 12 },

  // Urgency
  urgencyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF3E0', borderRadius: 12,
    padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#FFCC80',
  },
  urgencyText: { fontSize: 13, color: '#E65100', flex: 1 },

  // Footer CTA
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    paddingBottom: 28,
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.outlineVariant,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 12,
  },
  footerFromLabel: { fontSize: 11, color: C.onSurfaceMuted, marginBottom: 2 },
  footerPrice: { fontSize: 20, fontWeight: '800', color: C.primary },
  buyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryContainer, borderRadius: 16,
    paddingHorizontal: 28, height: 52,
    shadowColor: C.primaryContainer, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  buyBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
