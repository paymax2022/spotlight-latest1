// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

const LOCATION_USES = [
  { icon: 'home', text: 'Automatically find and link you to your estate' },
  { icon: 'navigate', text: 'Provide turn-by-turn directions within the estate' },
  { icon: 'shield-checkmark', text: 'Enhance security by verifying you\'re on-premises' },
  { icon: 'storefront', text: 'Show nearby vendors and services within your estate' },
];

export default function LocationPermissionScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="location" size={64} color="#10B981" />
          </View>
          <AppText variant="h1" style={styles.title}>Find Your Estate</AppText>
          <AppText variant="body" style={styles.subtitle}>
            Location access helps us connect you to the right estate and enhances your experience.
          </AppText>
        </View>

        <View style={styles.list}>
          <AppText variant="bodyMedium" style={styles.listTitle}>Location will be used to:</AppText>
          {LOCATION_USES.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={[styles.listIconWrap, { backgroundColor: '#ecfdf5' }]}>
                <Ionicons name={item.icon as any} size={20} color="#10B981" />
              </View>
              <AppText variant="body" style={styles.listText}>{item.text}</AppText>
            </View>
          ))}
        </View>

        <View style={styles.privacyNote}>
          <Ionicons name="information-circle" size={18} color={colors.neutral.textMuted} />
          <AppText variant="caption" style={styles.privacyText}>
            Your location is only accessed when the app is in use and is never shared with third parties.
          </AppText>
        </View>

        <AppButton
          title="Allow Location Access"
          variant="primary"
          onPress={() => router.push('/(auth)/biometric-setup' as never)}
        />
        <AppButton
          title="Skip"
          variant="ghost"
          onPress={() => router.push('/(auth)/biometric-setup' as never)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 24 },
  iconSection: { alignItems: 'center', gap: 14, paddingTop: 24 },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  list: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  listTitle: { marginBottom: 4 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listText: { flex: 1, color: colors.neutral.textMuted },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.neutral.surfaceAlt,
    borderRadius: 10,
    padding: 12,
  },
  privacyText: { color: colors.neutral.textMuted, flex: 1, lineHeight: 18 },
});
