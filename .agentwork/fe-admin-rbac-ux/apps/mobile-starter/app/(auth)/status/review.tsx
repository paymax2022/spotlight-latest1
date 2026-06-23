// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function ReviewScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="information-circle" size={80} color="#0051d5" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Under Review</AppText>
          <AppText variant="body" style={styles.body}>
            Your account is currently under additional review by our team. This is a routine security and verification process.
          </AppText>

          <View style={styles.timelineBox}>
            <AppText variant="bodyMedium" style={styles.timelineTitle}>Expected Timeline</AppText>
            <View style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <AppText variant="body" style={styles.timelineText}>Initial review: 1–2 business days</AppText>
            </View>
            <View style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <AppText variant="body" style={styles.timelineText}>Additional verification (if required): 3–5 days</AppText>
            </View>
            <View style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <AppText variant="body" style={styles.timelineText}>Decision notification via email and push notification</AppText>
            </View>
          </View>

          <AppText variant="caption" style={styles.note}>
            You do not need to take any action at this time. We'll reach out if we need additional information.
          </AppText>
        </AppCard>

        <AppButton title="Contact Support" variant="ghost" onPress={() => {}} />
        <AppButton title="Back to Login" variant="ghost" onPress={() => router.push('/(auth)/login' as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 16, alignItems: 'center' },
  iconSection: { paddingTop: 24 },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 14, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  timelineBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  timelineTitle: { color: '#0051d5', marginBottom: 2 },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0051d5',
    marginTop: 6,
  },
  timelineText: { flex: 1, color: colors.neutral.textMuted, lineHeight: 20 },
  note: { color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 18 },
});
