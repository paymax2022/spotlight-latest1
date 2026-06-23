// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function SuspendedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="warning" size={80} color="#F59E0B" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Account Suspended</AppText>
          <AppText variant="body" style={styles.body}>
            Your account has been temporarily suspended by estate management.
          </AppText>

          <View style={styles.reasonBox}>
            <AppText variant="bodyMedium" style={styles.reasonTitle}>Reason:</AppText>
            <AppText variant="body" style={styles.reasonText}>
              Your account suspension reason will appear here as communicated by the estate management team. Please contact support for more details.
            </AppText>
          </View>

          <AppText variant="caption" style={styles.note}>
            A suspension is temporary. Once resolved, your full access will be restored.
          </AppText>
        </AppCard>

        <AppButton title="Contact Support" variant="primary" onPress={() => {}} />
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
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 14, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted },
  reasonBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    gap: 6,
  },
  reasonTitle: { color: '#d97706' },
  reasonText: { color: colors.neutral.textMuted, lineHeight: 20 },
  note: { color: colors.neutral.textMuted, textAlign: 'center' },
});
