import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, MessageCircle, Mail, Phone, HelpCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { HomeMenuButton } from '@/components/HomeMenu';

const FAQS = [
  { q: 'How many free votes do I get per day?', a: 'You get 5 free votes per contest per day. They reset at midnight WAT.' },
  { q: 'Can I vote for more than one contestant?', a: 'Yes! You can split your free votes across contestants, or buy packages for specific contestants.' },
  { q: 'My payment went through but I didn\'t get votes.', a: 'Please contact support within 48 hours with your transaction reference. We\'ll investigate and credit you within 24 hours.' },
  { q: 'How do I know my votes counted?', a: 'You\'ll receive a confirmation with a reference number after each vote. You can also check "My Votes" for a full history.' },
  { q: 'Can I get a refund?', a: 'Votes already cast cannot be refunded. For uncast votes due to technical errors, contact support within 48 hours.' },
];

const CONTACT_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp Support', sub: '+234 800 SPOTLIGHT', Icon: MessageCircle, color: '#25D366', action: () => Linking.openURL('https://wa.me/2348005765746') },
  { id: 'email',    label: 'Email Support',    sub: 'support@spotlight.ng',  Icon: Mail,          color: Colors.secondary, action: () => Linking.openURL('mailto:support@spotlight.ng') },
  { id: 'call',     label: 'Call Us',          sub: '+234 800 000 0000',     Icon: Phone,         color: Colors.primary, action: () => Linking.openURL('tel:+2348000000000') },
];

export default function VotingSupportScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Help & Support</Text>
        <HomeMenuButton />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Contact options */}
        <Text style={styles.sectionLabel}>Contact Us</Text>
        <View style={styles.contactList}>
          {CONTACT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={opt.action}
              style={({ pressed }) => [styles.contactCard, shadow1, pressed && { opacity: 0.88 }]}
            >
              <View style={[styles.contactIcon, { backgroundColor: opt.color + '18' }]}>
                <opt.Icon size={20} color={opt.color} strokeWidth={1.8} />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactLabel}>{opt.label}</Text>
                <Text style={styles.contactSub}>{opt.sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* FAQs */}
        <View style={styles.faqHeader}>
          <HelpCircle size={18} color={Colors.primary} strokeWidth={1.8} />
          <Text style={styles.sectionLabel}>Frequently Asked Questions</Text>
        </View>
        <View style={styles.faqList}>
          {FAQS.map((faq, i) => (
            <View key={i} style={[styles.faqCard, shadow1]}>
              <Text style={styles.faqQ}>{faq.q}</Text>
              <Text style={styles.faqA}>{faq.a}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:    { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:      { ...Typography.titleLg, color: Colors.onSurface },
  content:    { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 60 },
  sectionLabel: { ...Typography.titleMd, color: Colors.onSurface },
  contactList:  { gap: Spacing.sm },
  contactCard:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  contactIcon:  { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  contactInfo:  { flex: 1 },
  contactLabel: { ...Typography.labelMd, color: Colors.onSurface },
  contactSub:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  faqHeader:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  faqList:    { gap: Spacing.sm },
  faqCard:    { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  faqQ:       { ...Typography.labelMd, color: Colors.onSurface },
  faqA:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
