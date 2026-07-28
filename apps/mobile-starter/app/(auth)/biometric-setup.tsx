// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

export default function BiometricSetupScreen() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEnable = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    router.push('/(protected)/(tabs)' as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Biometric Login</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="finger-print" size={80} color={colors.primary.DEFAULT} />
          </View>
          <AppText variant="h1" style={styles.title}>Enable Biometric Login</AppText>
          <AppText variant="body" style={styles.subtitle}>
            Use your fingerprint or face to sign in quickly and securely without a password.
          </AppText>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleLeft}>
            <AppText variant="bodyMedium">Enable biometric authentication</AppText>
            <AppText variant="caption" style={styles.toggleCaption}>Face ID or fingerprint</AppText>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={styles.benefitsList}>
          {[
            { icon: 'flash', text: 'Log in instantly without typing your password' },
            { icon: 'shield-checkmark', text: 'Your biometric data never leaves your device' },
            { icon: 'lock-open', text: 'Can be disabled from account settings at any time' },
          ].map((item, i) => (
            <View key={i} style={styles.benefitItem}>
              <Ionicons name={item.icon as any} size={20} color={colors.primary.DEFAULT} />
              <AppText variant="body" style={styles.benefitText}>{item.text}</AppText>
            </View>
          ))}
        </View>

        <AppButton
          title="Enable & Continue"
          variant="primary"
          loading={loading}
          onPress={handleEnable}
        />
        <AppButton
          title="Skip for now"
          variant="ghost"
          onPress={() => router.push('/(protected)/(tabs)' as never)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    backgroundColor: colors.primary.DEFAULT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  content: { padding: 20, gap: 20 },
  iconSection: { alignItems: 'center', gap: 14, paddingVertical: 16 },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.neutral.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  toggleLeft: { flex: 1, gap: 2 },
  toggleCaption: { color: colors.neutral.textMuted },
  benefitsList: { gap: 12 },
  benefitItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  benefitText: { flex: 1, color: colors.neutral.textMuted, lineHeight: 20 },
});
