// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

export default function PrivacyScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <AppText variant="h2" style={styles.docTitle}>Paymax Privacy Policy</AppText>
        <AppText variant="caption" style={styles.docDate}>Last updated: June 2026</AppText>

        {[
          { heading: '1. Information We Collect', body: 'We collect information you provide directly (name, email, phone number, address), information from your use of our services (transaction history, device info, location), and information from third parties (identity verification providers, payment processors).' },
          { heading: '2. How We Use Your Information', body: 'We use your information to provide and improve our services, process transactions, send notifications about estate activities and payments, verify your identity, comply with legal obligations, and prevent fraud.' },
          { heading: '3. Data Sharing', body: 'We do not sell your personal data. We share information with estate management, service providers who help us operate the platform, and regulatory authorities when required by law.' },
          { heading: '4. Data Retention', body: 'We retain your personal data for as long as your account is active or as needed to provide services. Financial transaction records are retained for 7 years in compliance with Nigerian financial regulations.' },
          { heading: '5. Your Rights (NDPR)', body: 'Under the Nigeria Data Protection Regulation, you have the right to access, correct, or delete your personal data, object to processing, and data portability. Contact us at privacy@paymax.africa.' },
          { heading: '6. Security', body: 'We implement industry-standard security measures including encryption in transit and at rest, access controls, and regular security audits to protect your data.' },
          { heading: '7. Contact Us', body: 'For privacy-related inquiries, contact our Data Protection Officer at privacy@paymax.africa or write to Paymax Technologies, Lagos, Nigeria.' },
        ].map((section, i) => (
          <View key={i} style={styles.section}>
            <AppText variant="bodyMedium" style={styles.sectionHeading}>{section.heading}</AppText>
            <AppText variant="body" style={styles.sectionBody}>{section.body}</AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.checkRow} onPress={() => setAgreed((v) => !v)}>
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            {agreed && <Ionicons name="checkmark" size={14} color="#ffffff" />}
          </View>
          <AppText variant="body" style={styles.checkLabel}>I have read and agree to the Privacy Policy</AppText>
        </Pressable>
        <AppButton title="Accept & Continue" variant="primary" onPress={() => router.back()} disabled={!agreed} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    backgroundColor: colors.primary.DEFAULT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#ffffff' },
  content: { padding: 20, gap: 16, paddingBottom: 8 },
  docTitle: {},
  docDate: { color: colors.neutral.textMuted, marginTop: -8 },
  section: { gap: 6 },
  sectionHeading: { color: colors.neutral.text },
  sectionBody: { color: colors.neutral.textMuted, lineHeight: 22 },
  footer: { padding: 20, gap: 14, borderTopWidth: 1, borderTopColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  checkLabel: { flex: 1 },
});
