import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Headset, ShieldCheck, MessageSquare, Phone, Link2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { StaysColors } from '@/features/stays/constants/stays.constants';

/** "Book with an agent" entry (PRD §17 H, screen 55). */
export default function BookWithAgentScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book with an agent" subtitle="Assisted booking" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Headset size={28} color={Colors.primary} /></View>
          <Text style={styles.title}>Let a Paymax agent help you book</Text>
          <Text style={styles.sub}>Prefer a hand? An agent can find a stay, hold the rate and prepare your booking — you just pay securely from your wallet or card.</Text>
        </View>

        <View style={styles.points}>
          <Point icon={<ShieldCheck size={18} color={StaysColors.ok} />} text="The booking stays on your account — always your identity." />
          <Point icon={<Link2 size={18} color={Colors.primary} />} text="Receive a secure link to review and pay for what the agent prepared." />
          <Point icon={<MessageSquare size={18} color={Colors.primary} />} text="Chat or call to agree dates, budget and preferences." />
        </View>

        <View style={styles.contactCard}>
          <Phone size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>Talk to an agent</Text>
            <Text style={styles.contactSub}>Mon–Sun, 8am–10pm WAT</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Connect with an agent" onPress={() => router.push('/stays/agent/handoff')} />
        <PrimaryButton label="I have a booking link" variant="secondary" onPress={() => router.push('/stays/agent/pay-prepared')} />
      </View>
    </SafeAreaView>
  );
}

function Point({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>{icon}</View>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  points: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pointIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  pointText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md },
  contactTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  contactSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
});
