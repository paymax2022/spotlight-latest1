// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function ApprovedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark-circle" size={80} color="#10B981" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>You're Approved!</AppText>
          <AppText variant="body" style={styles.body}>
            Welcome to your estate community. Your account has been verified and you now have full access to all Paymax Estate features.
          </AppText>

          <View style={styles.featureList}>
            {[
              { icon: 'wallet', text: 'Pay dues and manage payments' },
              { icon: 'shield-checkmark', text: 'Access gate management' },
              { icon: 'people', text: 'Engage with your community' },
              { icon: 'home', text: 'Manage your property' },
            ].map((item, i) => (
              <View key={i} style={styles.featureItem}>
                <Ionicons name={item.icon as any} size={18} color="#10B981" />
                <AppText variant="body" style={styles.featureText}>{item.text}</AppText>
              </View>
            ))}
          </View>
        </AppCard>

        <AppButton
          title="Go to Dashboard"
          variant="primary"
          onPress={() => router.replace('/(protected)/(tabs)' as never)}
        />
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
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 16, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  featureList: { gap: 10, marginTop: 4 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { color: colors.neutral.textMuted },
});
