// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function LockedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="lock-closed" size={80} color="#dc2626" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Account Locked</AppText>
          <AppText variant="body" style={styles.body}>
            Your account has been locked due to a security policy violation. This action was taken to protect your account and the estate community.
          </AppText>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color="#dc2626" />
            <AppText variant="body" style={styles.infoText}>
              A locked account cannot be unlocked through the app. Please contact estate management or Paymax support directly.
            </AppText>
          </View>

          <AppText variant="caption" style={styles.note}>
            Reference: ACC-LOCK-XXXXXX
          </AppText>
        </AppCard>

        <AppButton title="Contact Support" variant="primary" onPress={() => {}} />
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
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 14, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
  },
  infoText: { flex: 1, color: '#dc2626', lineHeight: 20 },
  note: { color: colors.neutral.placeholder, fontFamily: 'monospace' },
});
