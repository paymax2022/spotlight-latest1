import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LifeBuoy, Search, BookOpen, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, FaqAccordion } from '@/features/doctor/components';
import { useFaqs, useHelpArticles, useSupportTickets } from '@/features/doctor/hooks';
import type { SupportTicket, SupportTicketStatus } from '@/types/doctor';

// ── Section AA — Support & Dispute · Help centre hub (AA.1-2-4) ────────────────
// EXTENDED: the Phase 1 support form moved to support/tickets/new; this hub now
// surfaces FAQ search, help articles, contact/ticket/dispute entry points and a
// ticket list (status / resolved are STATES of the row). Reuses the Phase 1
// useSupportTickets read; FAQs / help articles are Batch 7 reads.

const STATUS_COLOR: Record<SupportTicketStatus, { fg: string; bg: string }> = {
  open:        { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  in_progress: { fg: Colors.primary,          bg: Colors.iconBgPurple },
  resolved:    { fg: Colors.teal,             bg: Colors.iconBgTeal },
  closed:      { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow },
};

export default function SupportScreen() {
  const { data: faqs = [] } = useFaqs();
  const { data: articles = [] } = useHelpArticles();
  const { data: tickets = [], isLoading, isError, refetch } = useSupportTickets();
  const [query, setQuery] = useState('');

  const filteredFaqs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q));
  }, [faqs, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Help & Support" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.searchWrap}>
          <TextInputField
            placeholder="Search help articles & FAQs"
            value={query}
            onChangeText={setQuery}
            leftIcon={<Search size={18} color={Colors.outline} strokeWidth={2} />}
          />
        </View>

        <View style={styles.menu}>
          <ProfileMenuItem icon="MessageSquarePlus" iconColor={Colors.primary} bgColor={Colors.iconBgPurple} label="Contact support" onPress={() => router.push('/(doctor)/support/tickets/new')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="AlertTriangle" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Raise a dispute" onPress={() => router.push('/(doctor)/support/disputes')} />
          <View style={styles.divider} />
          <ProfileMenuItem icon="Wrench" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Report a technical issue" onPress={() => router.push({ pathname: '/(doctor)/support/tickets/new', params: { category: 'Technical' } })} />
        </View>

        <SectionCard title="Help articles" style={styles.card}>
          {articles.length === 0 ? (
            <Text style={styles.muted}>No articles yet.</Text>
          ) : (
            articles.map((a, i) => (
              <View key={a.id} style={[styles.article, i > 0 && styles.rowBorder]}>
                <BookOpen size={18} color={Colors.primary} strokeWidth={2} />
                <View style={styles.articleBody}>
                  <Text style={styles.articleTitle} numberOfLines={2}>{a.title}</Text>
                  <Text style={styles.articleSummary} numberOfLines={2}>{a.summary}</Text>
                  <Text style={styles.articleMeta}>{a.readMins} min read</Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <Text style={styles.groupTitle}>Frequently asked questions</Text>
        {filteredFaqs.length === 0 ? (
          <StateView variant="empty" icon={Search} title="No matching FAQs" message="Try a different search term." />
        ) : (
          <View style={styles.faqList}>
            {filteredFaqs.map((f) => <FaqAccordion key={f.id} item={f} />)}
          </View>
        )}

        <Text style={styles.groupTitle}>Your tickets</Text>
        {isLoading && tickets.length === 0 ? (
          <StateView variant="loading" label="Loading tickets" />
        ) : isError ? (
          <StateView variant="error" message="We could not load your tickets." onRetry={() => refetch()} />
        ) : tickets.length === 0 ? (
          <StateView variant="empty" icon={LifeBuoy} title="No tickets yet" message="Tickets you open will appear here." />
        ) : (
          <View style={styles.list}>
            {tickets.map((t) => <TicketRow key={t.id} ticket={t} onPress={() => router.push({ pathname: '/(doctor)/support/chat/[threadId]', params: { threadId: t.id, title: t.subject } })} />)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TicketRow({ ticket, onPress }: { ticket: SupportTicket; onPress: () => void }) {
  const colors = STATUS_COLOR[ticket.status];
  const date = new Date(ticket.updatedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ticket, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={ticket.subject}>
      <View style={styles.ticketTop}>
        <Text style={styles.ticketSubject} numberOfLines={1}>{ticket.subject}</Text>
        <View style={[styles.statusPill, { backgroundColor: colors.bg }]}>
          <Text style={[styles.statusText, { color: colors.fg }]}>{ticket.status.replace('_', ' ')}</Text>
        </View>
      </View>
      <Text style={styles.ticketMeta} numberOfLines={1}>{ticket.ref} · {ticket.category} · {date}</Text>
      {!!ticket.lastReply && <Text style={styles.ticketReply} numberOfLines={2}>{ticket.lastReply}</Text>}
      <View style={styles.ticketCta}>
        <Text style={styles.ticketCtaText}>Open conversation</Text>
        <ChevronRight size={14} color={Colors.primary} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  searchWrap:    { marginBottom: Spacing.sm },
  card:          { marginBottom: Spacing.md },
  muted:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  menu:          { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  divider:       { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin },
  groupTitle:    { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  faqList:       { gap: Spacing.sm, marginBottom: Spacing.md },
  article:       { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  articleBody:   { flex: 1, gap: 2 },
  articleTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  articleSummary:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  articleMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  list:          { gap: Spacing.sm },
  ticket:        { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: 4 },
  ticketTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  ticketSubject: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  ticketMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  ticketReply:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statusPill:    { height: 24, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  pressed:       { opacity: 0.7 },
  ticketCta:     { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: Spacing.xs },
  ticketCtaText: { ...Typography.labelMd, color: Colors.primary },
  statusText:    { ...Typography.labelSm, fontWeight: '700', textTransform: 'capitalize' },
});
