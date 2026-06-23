// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppText } from '@/components/ui/AppText';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.illustrationContainer}>
            <Ionicons name="home" size={80} color="#ffffff" />
          </View>
          <Text style={styles.headerTitle}>Paymax Estate</Text>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.cardTitle}>Welcome to Paymax Estate</AppText>
          <AppText variant="body" style={styles.cardSubtitle}>
            The all-in-one platform for estate residents, homeowners, and managers.
            Pay dues, manage your community, and stay connected — all in one place.
          </AppText>

          <View style={styles.buttonGroup}>
            <AppButton
              title="Get Started"
              variant="primary"
              onPress={() => router.push('/(auth)/user-type' as never)}
            />
            <AppButton
              title="Sign In"
              variant="ghost"
              onPress={() => router.push('/(auth)/login' as never)}
            />
          </View>
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { gap: 0 },
  header: {
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 16,
  },
  illustrationContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  card: {
    margin: 20,
    gap: 16,
  },
  cardTitle: {
    textAlign: 'center',
  },
  cardSubtitle: {
    textAlign: 'center',
    color: colors.neutral.textMuted,
    lineHeight: 24,
  },
  buttonGroup: {
    gap: 12,
    marginTop: 8,
  },
});
