// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function RejectedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="close-circle" size={80} color="#dc2626" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Application Rejected</AppText>
          <AppText variant="body" style={styles.body}>
            Unfortunately, your application was not approved at this time.
          </AppText>

          <View style={styles.reasonBox}>
            <AppText variant="bodyMedium" style={styles.reasonTitle}>Reason:</AppText>
            <AppText variant="body" style={styles.reasonText}>
              Your application could not be verified against estate records. This may be due to an incorrect property address or missing documentation. Please review your information and try again, or contact estate management for assistance.
            </AppText>
          </View>
        </AppCard>

        <View style={styles.actions}>
          <AppButton
            title="Contact Support"
            variant="primary"
            onPress={() => {}}
          />
          <AppButton
            title="Try Again"
            variant="ghost"
            onPress={() => router.push('/(auth)/user-type' as never)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 20, alignItems: 'center' },
  iconSection: { paddingTop: 24 },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 14, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted },
  reasonBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
    gap: 6,
  },
  reasonTitle: { color: '#dc2626' },
  reasonText: { color: colors.neutral.textMuted, lineHeight: 20 },
  actions: { gap: 12, alignSelf: 'stretch' },
});
