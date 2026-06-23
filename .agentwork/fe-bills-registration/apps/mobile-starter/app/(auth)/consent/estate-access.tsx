// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

export default function EstateAccessScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Access Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <View style={styles.intro}>
          <Ionicons name="shield" size={48} color={colors.primary.DEFAULT} />
          <AppText variant="h2" style={styles.docTitle}>Estate Access Policy</AppText>
          <AppText variant="body" style={styles.introBody}>
            To ensure the safety and security of all residents, the following access rules apply to all occupants, visitors, and service personnel within this estate.
          </AppText>
        </View>

        {[
          { heading: 'Resident Access', body: 'All registered residents are granted 24/7 access to the estate upon verification of their Paymax identity. Access may be revoked in cases of outstanding dues, security violations, or as directed by estate management.' },
          { heading: 'Visitor Management', body: 'Visitors may only access the estate upon approval from a registered resident. Pre-approvals can be set up via the Paymax app. All visitors must present valid identification at the gate.' },
          { heading: 'Vehicle Access', body: 'Only registered vehicles are permitted beyond the first security checkpoint. Vehicle registration must be completed and kept current through the Paymax app. Unregistered vehicles will be turned away.' },
          { heading: 'Delivery & Service Personnel', body: 'Delivery personnel and contractors must be pre-approved or confirmed in real-time by the receiving resident. Unannounced service visits may be denied access.' },
          { heading: 'Payment Obligations', body: 'Access to certain estate amenities (pool, gym, clubhouse) may be gated behind payment of current service charges. Residents with outstanding dues exceeding 90 days may face restricted access.' },
          { heading: 'Emergency Access', body: 'Emergency services (police, fire, ambulance) have unconditional access to the estate at all times. Residents must not obstruct emergency access.' },
          { heading: 'Data Collection at Gate', body: 'Entry and exit logs are recorded automatically via the Paymax gate management system. This data is used solely for security purposes and retained for 90 days.' },
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
          <AppText variant="body" style={styles.checkLabel}>I understand and accept the estate access policy</AppText>
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
  intro: { alignItems: 'center', gap: 10, marginBottom: 4 },
  docTitle: { textAlign: 'center' },
  introBody: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
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
