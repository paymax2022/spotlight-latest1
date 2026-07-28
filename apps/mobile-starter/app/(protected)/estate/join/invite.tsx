// @ts-nocheck
// Join estate with an invite code
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { joinWithInviteCode } from '@/api/estate.api';
import { colors } from '@/theme';

export default function JoinWithInviteScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const joinMutation = useMutation({
    mutationFn: () => joinWithInviteCode(code.trim().toUpperCase()),
    onSuccess: () => setSuccess(true),
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Invalid or expired invite code.'),
  });

  if (success) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Ionicons name="checkmark-circle" size={72} color="#00B894" />
        <Text style={styles.successTitle}>Welcome!</Text>
        <Text style={styles.successSub}>You have joined the estate successfully.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/estate' as never)}>
          <Text style={styles.primaryBtnText}>Go to Estate</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Enter Invite Code</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconBox}>
          <Ionicons name="key" size={52} color={colors.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>Join with Invite Code</Text>
        <Text style={styles.subtitle}>Ask your estate admin or a resident for a code to join.</Text>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Invite Code</Text>
        <TextInput
          style={styles.codeInput}
          placeholder="e.g. A1B2C3D4"
          placeholderTextColor={colors.neutral.placeholder}
          value={code}
          onChangeText={(t) => { setCode(t); setError(null); }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
        />
        <Text style={styles.hint}>Codes are case-insensitive and expire after a set date.</Text>

        <Pressable
          style={[styles.primaryBtn, (!code.trim() || joinMutation.isPending) && styles.primaryBtnDisabled]}
          disabled={!code.trim() || joinMutation.isPending}
          onPress={() => { setError(null); joinMutation.mutate(); }}
        >
          {joinMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Join Estate</Text>
          }
        </Pressable>

        <Pressable style={styles.altLink} onPress={() => router.push('/estate/join' as never)}>
          <Text style={styles.altLinkText}>Do not have a code? Request access instead</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { flex: 1, padding: 24, gap: 12 },
  iconBox: { alignItems: 'center', paddingVertical: 20 },
  title: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', marginBottom: 8 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  codeInput: {
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16,
    fontSize: 22, fontWeight: '700', color: colors.neutral.text, letterSpacing: 4,
    borderWidth: 2, borderColor: colors.neutral.border, textAlign: 'center',
  },
  hint: { fontSize: 12, color: colors.neutral.placeholder, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  successTitle: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  successSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  altLink: { alignItems: 'center', paddingVertical: 8 },
  altLinkText: { fontSize: 14, color: colors.secondary.DEFAULT, fontWeight: '600' },
});
