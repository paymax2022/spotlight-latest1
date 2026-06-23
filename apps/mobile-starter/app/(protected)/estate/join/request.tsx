// @ts-nocheck
// Request access to an estate (no invite code)
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestAccess } from '@/api/estate.api';
import { colors } from '@/theme';

export default function RequestAccessScreen() {
  const router = useRouter();
  const { estateId, estateName } = useLocalSearchParams<{ estateId: string; estateName: string }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => requestAccess(estateId, message.trim() || undefined),
    onSuccess: () => router.replace({ pathname: '/estate/join/pending', params: { estateId, estateName } } as never),
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Could not send request. Try again.'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Request Access</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!estateId && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>
              Select an estate before requesting access.
            </Text>
          </View>
        )}

        <View style={styles.estateCard}>
          <Ionicons name="home" size={28} color={colors.primary.DEFAULT} />
          <View style={{ flex: 1 }}>
            <Text style={styles.estateCardLabel}>Requesting to join</Text>
            <Text style={styles.estateCardName}>{estateName || 'Selected Estate'}</Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Message to Admin (optional)</Text>
        <TextInput
          style={styles.textarea}
          placeholder="Introduce yourself — your unit, occupation, or reason for joining..."
          placeholderTextColor={colors.neutral.placeholder}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          maxLength={500}
        />
        <Text style={styles.charCount}>{message.length}/500</Text>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>
            The estate admin will review your request. You will be notified when approved or rejected.
          </Text>
        </View>

        <Pressable
          style={[styles.primaryBtn, requestMutation.isPending && styles.primaryBtnDisabled]}
          disabled={requestMutation.isPending}
          onPress={() => {
            if (!estateId) {
              router.replace('/estate/join' as never);
              return;
            }
            setError(null);
            requestMutation.mutate();
          }}
        >
          {requestMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Send Request</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  estateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: colors.primary.DEFAULT + '30',
  },
  estateCardLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  estateCardName: { fontSize: 17, fontWeight: '800', color: colors.neutral.text, marginTop: 2 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  textarea: {
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14,
    fontSize: 15, color: colors.neutral.text, minHeight: 120,
    borderWidth: 1, borderColor: colors.neutral.border,
  },
  charCount: { fontSize: 12, color: colors.neutral.placeholder, textAlign: 'right', marginTop: -8 },
  infoBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: colors.secondary.DEFAULT + '12', padding: 14, borderRadius: 12,
  },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
