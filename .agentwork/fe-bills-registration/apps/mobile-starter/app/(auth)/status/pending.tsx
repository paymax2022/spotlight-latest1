// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function PendingScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="time" size={80} color="#F59E0B" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Application Submitted</AppText>
          <AppText variant="body" style={styles.body}>
            Your account is currently under review by estate management. You'll receive a notification once your application has been approved.
          </AppText>

          <View style={styles.stepsList}>
            {[
              { icon: 'checkmark-circle', label: 'Application received', done: true },
              { icon: 'time', label: 'Under review by estate admin', done: false },
              { icon: 'notifications', label: 'You\'ll be notified of the outcome', done: false },
            ].map((step, i) => (
              <View key={i} style={styles.step}>
                <Ionicons
                  name={step.icon as any}
                  size={22}
                  color={step.done ? '#10B981' : colors.neutral.placeholder}
                />
                <AppText variant="body" style={[styles.stepText, step.done && styles.stepTextDone]}>
                  {step.label}
                </AppText>
              </View>
            ))}
          </View>
        </AppCard>

        <Pressable onPress={() => router.push('/(auth)/login' as never)} style={styles.link}>
          <AppText variant="caption" style={styles.linkText}>Back to Sign In</AppText>
        </Pressable>
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
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 16, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  stepsList: { gap: 12, marginTop: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepText: { color: colors.neutral.textMuted },
  stepTextDone: { color: '#10B981', fontWeight: '600' },
  link: { paddingVertical: 8 },
  linkText: { color: colors.primary.DEFAULT },
});
