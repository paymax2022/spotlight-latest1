// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

const NOTIFICATION_TYPES = [
  { icon: 'wallet', text: 'Payment confirmations and due date reminders' },
  { icon: 'shield-checkmark', text: 'Security alerts and visitor approvals' },
  { icon: 'megaphone', text: 'Estate announcements and community updates' },
  { icon: 'receipt', text: 'Transaction receipts and billing statements' },
  { icon: 'people', text: 'Community events and AGM notices' },
];

export default function NotificationPermissionScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="notifications" size={64} color={colors.primary.DEFAULT} />
          </View>
          <AppText variant="h1" style={styles.title}>Stay in the loop</AppText>
          <AppText variant="body" style={styles.subtitle}>
            Allow Paymax to send you notifications so you never miss important estate updates.
          </AppText>
        </View>

        <View style={styles.list}>
          <AppText variant="bodyMedium" style={styles.listTitle}>You'll be notified about:</AppText>
          {NOTIFICATION_TYPES.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.listIconWrap}>
                <Ionicons name={item.icon as any} size={20} color={colors.primary.DEFAULT} />
              </View>
              <AppText variant="body" style={styles.listText}>{item.text}</AppText>
            </View>
          ))}
        </View>

        <AppButton
          title="Allow Notifications"
          variant="primary"
          onPress={() => router.push('/(auth)/permissions/camera' as never)}
        />
        <AppButton
          title="Skip"
          variant="ghost"
          onPress={() => router.push('/(auth)/permissions/camera' as never)}
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
    backgroundColor: colors.neutral.surfaceAlt,
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
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listText: { flex: 1, color: colors.neutral.textMuted },
});
