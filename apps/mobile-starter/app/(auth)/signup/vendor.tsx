// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppText } from '@/components/ui/AppText';

const SERVICE_CATEGORIES = ['Plumbing', 'Electrical', 'General', 'Pest Control', 'Cleaning', 'Other'];

export default function VendorSignupScreen() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!businessName || !phone || !email || !category || !password) {
      setError('Please fill in all fields and select a service category.');
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      router.push('/(auth)/status/pending' as never);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Vendor / Contractor Registration</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#dc2626" />
            <AppText variant="caption" style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        <AppInput label="Full Name / Business Name" value={businessName} onChangeText={setBusinessName} placeholder="Your name or business name" />
        <AppInput label="Phone Number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+234 800 000 0000" />
        <AppInput label="Email Address" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />

        <View>
          <AppText variant="bodyMedium" style={styles.sectionLabel}>Service Category</AppText>
          <View style={styles.chips}>
            {SERVICE_CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                style={[styles.chip, category === cat && styles.chipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <AppInput label="Password" value={password} onChangeText={setPassword} variant="password" placeholder="Create a password" />

        <AppButton title="Create Account" variant="primary" loading={loading} onPress={handleSubmit} />

        <Pressable onPress={() => router.push('/(auth)/login' as never)} style={styles.loginLink}>
          <AppText variant="caption" style={styles.loginLinkText}>Already have an account? Sign in</AppText>
        </Pressable>
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
  content: { padding: 20, gap: 16 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: '#dc2626', flex: 1 },
  sectionLabel: { marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.neutral.border,
    backgroundColor: colors.neutral.surface,
  },
  chipActive: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
  },
  chipText: { fontSize: 13, color: colors.neutral.text },
  chipTextActive: { color: '#ffffff', fontWeight: '600' },
  loginLink: { alignItems: 'center', paddingVertical: 8 },
  loginLinkText: { color: colors.primary.DEFAULT },
});
