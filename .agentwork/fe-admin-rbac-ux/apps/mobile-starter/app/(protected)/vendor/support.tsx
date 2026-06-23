// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FAQS = [
  { q: 'How do I accept a job?', a: 'Tap "Accept Job" on any available job listing. You will be notified when the resident confirms.' },
  { q: 'How long does payout take?', a: 'Payouts are processed within 1–2 business days after you submit a payout request.' },
  { q: 'What if I have a dispute?', a: 'Contact support via the form below and we will help mediate within 24 hours.' },
];
const TICKETS = [
  { id: '#1002', subject: 'Delayed payment', date: 'Dec 10', status: 'Open' },
];

export default function VendorSupport() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Support</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>FAQs</Text>
        {FAQS.map((faq, i) => (
          <Pressable key={i} style={styles.faqCard} onPress={() => setExpanded(expanded === i ? null : i)}>
            <View style={styles.faqHeader}>
              <Text style={styles.faqQ}>{faq.q}</Text>
              <Ionicons name={expanded === i ? 'chevron-up' : 'chevron-down'} size={16} color={colors.neutral.placeholder} />
            </View>
            {expanded === i && <Text style={styles.faqA}>{faq.a}</Text>}
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>Submit a Ticket</Text>
        <View style={styles.formCard}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Subject</Text>
            <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Brief subject..." placeholderTextColor={colors.neutral.placeholder} />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Message</Text>
            <TextInput style={[styles.input, styles.textarea]} value={message} onChangeText={setMessage} placeholder="Describe your issue..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={4} textAlignVertical="top" />
          </View>
          <Pressable style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Submit Ticket</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>My Tickets</Text>
        {TICKETS.map(t => (
          <View key={t.id} style={styles.ticketCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{t.subject}</Text>
              <Text style={styles.listSub}>{t.id} · {t.date}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.secondary.amber + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.secondary.amber }]}>{t.status}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  faqCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, shadowColor: '#000', shadowOpacity: 0.03, elevation: 1 },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text, paddingRight: 8 },
  faqA: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 8, lineHeight: 20 },
  formCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, gap: 14 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 100, paddingTop: 12 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ticketCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
