import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LifeBuoy, MessageCircle, ChevronRight, ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ReferralHeader } from '@/features/referral/components';

// M-ACC-05 — Help & support. FAQ, chat, ticket.
const FAQS = [
  { q: 'When do I actually earn?', a: 'You earn when a friend you referred completes KYC and makes genuine, verified transactions. Rewards then vest before they can be withdrawn.' },
  { q: 'Why is my reward "vesting"?', a: 'Vesting releases rewards in stages as your friend proves real value. This keeps the program fair and prevents fraud.' },
  { q: 'I forgot to enter a code at signup.', a: 'You can add a friend’s code within the grace window from the claim-code screen. After the window closes, attribution is locked.' },
  { q: 'A reward was clawed back — why?', a: 'Rewards can be reversed if a referral is later found to be invalid, fraudulent, or self-referred.' },
  { q: 'Is this a pyramid scheme?', a: 'No. Every naira ties to a friend’s real, verified activity. We never pay for recruitment or signups alone, and overrides are capped.' },
];

export default function HelpSupport() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Help & support" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><LifeBuoy size={24} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>How can we help?</Text>
        </View>

        <Text style={styles.sectionTitle}>Frequently asked</Text>
        {FAQS.map((f, i) => {
          const expanded = open === i;
          return (
            <Pressable key={i} style={styles.faq} onPress={() => setOpen(expanded ? null : i)} accessibilityRole="button">
              <View style={styles.faqHead}>
                <Text style={styles.faqQ}>{f.q}</Text>
                {expanded ? <ChevronDown size={18} color={Colors.outline} strokeWidth={2} /> : <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />}
              </View>
              {expanded && <Text style={styles.faqA}>{f.a}</Text>}
            </Pressable>
          );
        })}

        <Pressable style={styles.chatRow} onPress={() => router.push('/referral/account/report-abuse')} accessibilityRole="button">
          <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.chatText}>Report a suspicious referral</Text>
          <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        </Pressable>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Contact support" onPress={() => router.push('/referral/account/report-abuse')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.sm },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: Spacing.sm },
  faq: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  faqQ: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  faqA: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  chatText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
