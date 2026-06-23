// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

export default function CommunityRulesScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Community Rules</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <View style={styles.intro}>
          <Ionicons name="people-circle" size={48} color={colors.primary.DEFAULT} />
          <AppText variant="h2" style={styles.docTitle}>Estate Community Rules</AppText>
          <AppText variant="body" style={styles.introBody}>
            To maintain a peaceful and orderly community, all residents and visitors are expected to abide by the following rules established by the Estate Management Association.
          </AppText>
        </View>

        {[
          { heading: '1. Noise & Quiet Hours', body: 'Residents must observe quiet hours between 10:00 PM and 6:00 AM. Music, generators, and construction activities must be kept to a minimum during these hours.' },
          { heading: '2. Common Areas', body: 'Common areas including car parks, gardens, recreational facilities, and walkways must be kept clean and tidy. Littering is strictly prohibited.' },
          { heading: '3. Visitor Policy', body: 'All visitors must be registered at the gate. Long-stay visitors (over 48 hours) must be formally registered with estate management. Residents are responsible for the conduct of their visitors.' },
          { heading: '4. Parking', body: 'Vehicles must be parked only in designated areas. Blocking of driveways, fire exits, or obstructing other residents is prohibited.' },
          { heading: '5. Pets', body: 'Pets must be kept within the owner\'s property or on a leash in common areas. Pet owners are responsible for cleaning up after their pets.' },
          { heading: '6. Alterations', body: 'No structural modifications to properties may be made without prior written approval from estate management. External aesthetic changes must conform to estate guidelines.' },
          { heading: '7. Service Charges & Levies', body: 'All residents are obligated to pay their service charges, levies, and dues as and when due. Failure to pay may result in restricted access to estate facilities and services.' },
          { heading: '8. Dispute Resolution', body: 'Disputes between residents must be reported to the Estate Management Association. Residents must not engage in conduct that disturbs the peace of the community.' },
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
          <AppText variant="body" style={styles.checkLabel}>I agree to abide by the community rules</AppText>
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
