import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, MessageCircleQuestion, BadgeAlert, Headset } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';

const FAQS = [
  { q: 'When am I charged for my booking?', a: 'Money is held — not charged — until the hotel confirms (two-step prebook → book). If the hotel cannot confirm, the hold is released automatically and you are never charged.' },
  { q: 'How do refunds work?', a: 'Free cancellation before the deadline gives an instant reversing credit to your Paymax wallet. Refunds are ledger entries, never a manual queue.' },
  { q: 'The hotel says it has no record of my booking. What do I do?', a: 'Use the dispute fast-path. Paymax guarantees confirmed inventory — we will resolve it directly with the property and protect your money.' },
  { q: 'Can I change my dates or guests?', a: 'Yes. Modify your booking and we re-prebook for the delta; any difference is charged or refunded via your wallet.' },
  { q: 'How do I pay if my wallet is short?', a: 'Top up instantly with your virtual account, or pay the balance by card via Paystack at checkout.' },
  { q: 'What is Paymax Stays loyalty?', a: 'A free, account-based tier programme. Completed stays unlock discounts on eligible rate plans and perks like free breakfast and late checkout.' },
];

export default function HelpCenterScreen() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Help center" subtitle="FAQs & support" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.quickRow}>
          <QuickCard icon={<MessageCircleQuestion size={20} color={Colors.primary} />} label="Contact support" onPress={() => router.push('/stays/support/contact')} />
          <QuickCard icon={<BadgeAlert size={20} color={Colors.error} />} label="Dispute fast-path" onPress={() => router.push('/stays/support/dispute')} />
        </View>

        <Text style={styles.sectionTitle}>Frequently asked</Text>
        {FAQS.map((f, i) => {
          const expanded = open === i;
          return (
            <Pressable key={i} style={styles.faq} onPress={() => setOpen(expanded ? null : i)}>
              <View style={styles.faqHead}>
                <Text style={styles.faqQ}>{f.q}</Text>
                {expanded ? <ChevronUp size={18} color={Colors.onSurfaceVariant} /> : <ChevronDown size={18} color={Colors.onSurfaceVariant} />}
              </View>
              {expanded ? <Text style={styles.faqA}>{f.a}</Text> : null}
            </Pressable>
          );
        })}

        <View style={styles.contactCard}>
          <Headset size={22} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>Still need help?</Text>
            <Text style={styles.contactSub}>Our support team responds 24/7.</Text>
          </View>
          <Pressable style={styles.contactBtn} onPress={() => router.push('/stays/support/contact')}>
            <Text style={styles.contactBtnText}>Contact</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickCard({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quick} onPress={onPress} accessibilityRole="button">
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  quickRow: { flexDirection: 'row', gap: Spacing.sm },
  quick: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm, alignItems: 'flex-start' },
  quickIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  faq: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  faqQ: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const, flex: 1 },
  faqA: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, lineHeight: 20 },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  contactTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  contactSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  contactBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  contactBtnText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '600' as const },
});
