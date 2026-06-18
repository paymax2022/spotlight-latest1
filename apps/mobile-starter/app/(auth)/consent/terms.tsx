// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

export default function TermsScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Terms and Conditions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <AppText variant="h2" style={styles.docTitle}>Paymax Terms of Service</AppText>
        <AppText variant="caption" style={styles.docDate}>Last updated: June 2026</AppText>

        {[
          { heading: '1. Acceptance of Terms', body: 'By accessing or using the Paymax Estate platform, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.' },
          { heading: '2. Use of Service', body: 'Paymax grants you a limited, non-exclusive, non-transferable licence to access and use the platform for your personal and estate management purposes. You agree not to misuse, reverse-engineer, or attempt to gain unauthorised access to any part of the service.' },
          { heading: '3. User Accounts', body: 'You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately of any unauthorised use of your account.' },
          { heading: '4. Financial Transactions', body: 'All payments processed through Paymax are subject to our payment policy. Paymax acts as a payment facilitator for estate dues, rent, and levies. Refunds are subject to estate management approval.' },
          { heading: '5. Privacy', body: 'Your use of Paymax is also governed by our Privacy Policy. We collect and process personal data in accordance with the Nigeria Data Protection Regulation (NDPR).' },
          { heading: '6. Limitation of Liability', body: 'To the maximum extent permitted by law, Paymax shall not be liable for any indirect, incidental, or consequential damages arising out of your use of the platform.' },
          { heading: '7. Changes to Terms', body: 'We reserve the right to modify these terms at any time. Continued use of the platform after changes constitutes acceptance of the new terms.' },
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
          <AppText variant="body" style={styles.checkLabel}>I have read and agree to these Terms</AppText>
        </Pressable>
        <AppButton
          title="Accept & Continue"
          variant="primary"
          onPress={() => router.back()}
          disabled={!agreed}
        />
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
