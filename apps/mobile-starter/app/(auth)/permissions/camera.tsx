// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

const CAMERA_USES = [
  { icon: 'person-circle', text: 'Upload your profile photo for estate identification' },
  { icon: 'card', text: 'Capture your ID document for KYC verification' },
  { icon: 'scan', text: 'Scan QR codes for gate access and payments' },
  { icon: 'camera', text: 'Document property issues for maintenance requests' },
];

export default function CameraPermissionScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="camera" size={64} color={colors.secondary.DEFAULT} />
          </View>
          <AppText variant="h1" style={styles.title}>Capture &amp; Verify</AppText>
          <AppText variant="body" style={styles.subtitle}>
            Camera access helps us verify your identity and makes estate living more convenient.
          </AppText>
        </View>

        <View style={styles.list}>
          <AppText variant="bodyMedium" style={styles.listTitle}>Camera will be used for:</AppText>
          {CAMERA_USES.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={[styles.listIconWrap, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name={item.icon as any} size={20} color={colors.secondary.DEFAULT} />
              </View>
              <AppText variant="body" style={styles.listText}>{item.text}</AppText>
            </View>
          ))}
        </View>

        <AppButton
          title="Allow Camera Access"
          variant="primary"
          onPress={() => router.push('/(auth)/permissions/location' as never)}
        />
        <AppButton
          title="Skip"
          variant="ghost"
          onPress={() => router.push('/(auth)/permissions/location' as never)}
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
    backgroundColor: '#eff6ff',
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
});
