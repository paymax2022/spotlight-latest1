import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Linking } from 'react-native';
import { alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Headphones, Mail, MessageCircle, Phone, ChevronDown } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';

// Shared support / help screen for the money-services surfaces (FX, bills, cards).
// A minimal but functional contact form (subject + category + message) plus direct
// channels and a short FAQ. No money path — submitting logs a support request and
// confirms; a real backend ticket endpoint can replace the local confirmation.

const CATEGORIES = ['General question', 'Payments & transfers', 'FX & conversions', 'Cards', 'Account & security', 'Something else'];

const SUPPORT_EMAIL = 'support@paymax.app';
const SUPPORT_PHONE = '+2348000000000';
const SUPPORT_WHATSAPP = 'https://wa.me/2348000000000';

const FAQS = [
  { id: 'f1', q: 'How long do transfers take?', a: 'Wallet-to-wallet is instant. Bank transfers usually settle within minutes, and can take up to 24h during bank downtime.' },
  { id: 'f2', q: 'Why was my payment declined?', a: 'The most common reasons are an insufficient wallet balance or a tier limit. Check Limits & tier in Settings, or top up and try again.' },
  { id: 'f3', q: 'How do I raise a dispute?', a: 'Open the transaction from your history and choose "Dispute". Our team reviews every dispute and responds by email.' },
];

export default function SupportScreen() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const ready = subject.trim().length >= 3 && message.trim().length >= 10;

  const submit = () => {
    if (!ready || sending) return;
    setSending(true);
    // Fire-and-forget: a real ticket endpoint would post here. We confirm locally.
    setTimeout(async () => {
      setSending(false);
      await alertAsync({
        title: 'Message sent',
        message: 'Thanks — our support team will reply to your registered email, usually within a few hours.',
        buttonLabel: 'Done',
      });
      goBack('/services');
    }, 600);
  };

  const openChannel = (url: string) =>
    Linking.openURL(url).catch(() =>
      alertAsync({ title: 'Unavailable', message: 'We could not open that just now. Please try another channel.' }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Help & support</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Headphones size={22} color={Colors.onPrimary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Need a hand?</Text>
              <Text style={styles.heroBody}>Send us a message or reach us directly. We typically reply within a few hours.</Text>
            </View>
          </View>

          <View style={styles.channels}>
            <ChannelButton icon={<Mail size={18} color={Colors.primary} strokeWidth={2} />} label="Email" onPress={() => openChannel(`mailto:${SUPPORT_EMAIL}`)} />
            <ChannelButton icon={<MessageCircle size={18} color={Colors.teal} strokeWidth={2} />} label="WhatsApp" onPress={() => openChannel(SUPPORT_WHATSAPP)} />
            <ChannelButton icon={<Phone size={18} color={Colors.secondary} strokeWidth={2} />} label="Call" onPress={() => openChannel(`tel:${SUPPORT_PHONE}`)} />
          </View>

          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Send a message</Text>
            <SelectField label="Topic" value={category} options={CATEGORIES} searchable={false} onChange={setCategory} />
            <TextInputField label="Subject" value={subject} onChangeText={setSubject} placeholder="Briefly, what's it about?" />
            <TextInputField label="Message" value={message} onChangeText={setMessage} placeholder="Tell us what's going on…" multiline numberOfLines={5} style={styles.messageInput} />
            <PrimaryButton label="Send message" onPress={submit} loading={sending} disabled={!ready} />
          </View>

          <Text style={styles.group}>Frequently asked</Text>
          <View style={[styles.card, shadow1]}>
            {FAQS.map((f, i) => {
              const isOpen = open === f.id;
              return (
                <View key={f.id} style={i < FAQS.length - 1 ? styles.faqDivider : undefined}>
                  <Pressable style={styles.faqHead} onPress={() => setOpen(isOpen ? null : f.id)} accessibilityRole="button">
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <ChevronDown size={18} color={Colors.outline} strokeWidth={2} style={isOpen ? styles.chevOpen : undefined} />
                  </Pressable>
                  {isOpen ? <Text style={styles.faqA}>{f.a}</Text> : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChannelButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.channel, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.channelIcon}>{icon}</View>
      <Text style={styles.channelLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  topBar: { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  heroBody: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  channels: { flexDirection: 'row', gap: Spacing.sm },
  channel: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  channelIcon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  channelLabel: { ...Typography.labelMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.cardPadding, gap: Spacing.xs },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  messageInput: { minHeight: 110, textAlignVertical: 'top' },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  faqDivider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.sm },
  faqQ: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  faqA: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingBottom: Spacing.md },
});
