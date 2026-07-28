// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listMyTickets, openTicket } from '@/api/support.api';
import { colors } from '@/theme';
import type { SupportTicket } from '@/types/fintech';

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  open: { color: '#0051d5', bg: '#DBEAFE' },
  pending: { color: '#d97706', bg: '#FEF3C7' },
  resolved: { color: '#16a34a', bg: '#D1FAE5' },
};

const FAQS = [
  { q: 'How do I fund my wallet?', a: 'Go to Wallet tab → Fund Wallet → Enter amount → Complete Paystack payment.' },
  { q: 'How long does a transfer take?', a: 'Transfers are usually instant. Some banks may take up to 2 hours.' },
  { q: 'How do I complete KYC?', a: 'Go to More → KYC Verification and follow the steps to submit your BVN or NIN.' },
  { q: 'What if my food order is wrong?', a: 'Go to More → Disputes and raise a dispute with your order reference.' },
];

export default function SupportScreen() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const query = useQuery({ queryKey: ['support-tickets'], queryFn: listMyTickets });

  const mutation = useMutation({
    mutationFn: () => openTicket({ subject: subject.trim(), message: message.trim() }),
    onSuccess: () => {
      setShowForm(false);
      setSubject(''); setMessage('');
      query.refetch();
    },
    onError: (err: any) => setError(err?.message || 'Failed to submit ticket.'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Support</Text>
        <Pressable style={styles.addBtn} onPress={() => setShowForm(!showForm)}>
          <Ionicons name={showForm ? 'close' : 'create-outline'} size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
      >
        {/* New Ticket Form */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New Support Ticket</Text>
            <Text style={styles.fieldLabel}>Subject</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                placeholder="Brief description of your issue"
                placeholderTextColor={colors.neutral.placeholder}
                value={subject}
                onChangeText={setSubject}
              />
            </View>
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Message</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={[styles.input, { minHeight: 80 }]}
                placeholder="Describe your issue in detail..."
                placeholderTextColor={colors.neutral.placeholder}
                value={message}
                onChangeText={setMessage}
                multiline
              />
            </View>
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <Pressable
              style={[styles.submitBtn, mutation.isPending && styles.submitBtnDisabled]}
              disabled={mutation.isPending}
              onPress={() => {
                setError(null);
                if (!subject.trim()) { setError('Subject is required'); return; }
                if (!message.trim()) { setError('Message is required'); return; }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Ticket</Text>}
            </Pressable>
          </View>
        )}

        {/* FAQs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          <View style={styles.faqCard}>
            {FAQS.map((faq, idx) => (
              <View key={idx} style={[styles.faqItem, idx < FAQS.length - 1 && styles.faqItemBorder]}>
                <Pressable style={styles.faqHeader} onPress={() => setExpandedFaq(expandedFaq === idx ? null : idx)}>
                  <Text style={styles.faqQ}>{faq.q}</Text>
                  <Ionicons
                    name={expandedFaq === idx ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.neutral.textMuted}
                  />
                </Pressable>
                {expandedFaq === idx && <Text style={styles.faqA}>{faq.a}</Text>}
              </View>
            ))}
          </View>
        </View>

        {/* My Tickets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Tickets</Text>
          {query.isLoading ? null : (query.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No support tickets yet</Text>
            </View>
          ) : (
            (query.data ?? []).map((ticket: SupportTicket) => {
              const s = STATUS_STYLE[ticket.status] ?? STATUS_STYLE.resolved;
              return (
                <View key={ticket.id} style={styles.ticketCard}>
                  <View style={styles.ticketHeader}>
                    <Text style={styles.ticketSubject} numberOfLines={1}>{ticket.subject}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                      <Text style={[styles.statusText, { color: s.color }]}>{ticket.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.ticketMessage} numberOfLines={2}>{ticket.message}</Text>
                  <Text style={styles.ticketDate}>{new Date(ticket.created_at).toLocaleDateString()}</Text>
                </View>
              );
            })
          )}
        </View>

        {/* Contact Channels */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Us</Text>
          <View style={styles.contactCard}>
            {[
              { icon: 'mail-outline', label: 'Email', value: 'support@paymax.ng' },
              { icon: 'logo-whatsapp', label: 'WhatsApp', value: '+234 800 PAYMAX' },
              { icon: 'call-outline', label: 'Hotline', value: '0800-PAYMAX' },
            ].map((c, idx, arr) => (
              <View key={c.label} style={[styles.contactRow, idx < arr.length - 1 && styles.contactBorder]}>
                <View style={styles.contactIcon}>
                  <Ionicons name={c.icon as never} size={20} color={colors.primary.DEFAULT} />
                </View>
                <View>
                  <Text style={styles.contactLabel}>{c.label}</Text>
                  <Text style={styles.contactValue}>{c.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.secondary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  formCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, marginBottom: 8 },
  inputBox: {
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.neutral.border,
  },
  input: { fontSize: 14, color: colors.neutral.text },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10, marginTop: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  submitBtn: {
    backgroundColor: colors.secondary.DEFAULT, borderRadius: 12, height: 48,
    alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  section: {},
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 12 },
  faqCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  faqItem: { padding: 16 },
  faqItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faqQ: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, flex: 1, paddingRight: 8 },
  faqA: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 8, lineHeight: 20 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  ticketCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  ticketSubject: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '700' },
  ticketMessage: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 8 },
  ticketDate: { fontSize: 11, color: colors.neutral.placeholder },
  contactCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  contactBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  contactIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  contactLabel: { fontSize: 12, color: colors.neutral.textMuted },
  contactValue: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, marginTop: 2 },
});
