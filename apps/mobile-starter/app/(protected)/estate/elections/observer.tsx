// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function ObserverAccess() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAccess() {
    if (code.length !== 6) { setError('Please enter a valid 6-digit observer code.'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/estate/elections/observer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Invalid observer code');
      // Navigate to the live results for the election
      const electionId = data.data?.election_id ?? data.election_id;
      router.push(`/estate/elections/${electionId}/results` as never);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Observer Access</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.heroSection}>
          <View style={s.iconCircle}>
            <Ionicons name="eye-outline" size={36} color={colors.primary.DEFAULT} />
          </View>
          <Text style={s.heroTitle}>Observer Mode</Text>
          <Text style={s.heroSubtitle}>Enter your 6-digit observer code to access live election results in read-only mode.</Text>
        </View>

        <View style={s.readOnlyBadge}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.secondary.amber} />
          <Text style={s.readOnlyText}>Read-only access — observers cannot vote or alter results</Text>
        </View>

        <Text style={s.label}>Observer Code</Text>
        <TextInput
          style={s.codeInput}
          placeholder="000000"
          placeholderTextColor={colors.neutral.placeholder}
          value={code}
          onChangeText={v => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          textAlign="center"
        />

        {error ? (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable style={[s.accessBtn, code.length !== 6 && s.accessBtnDisabled]} onPress={handleAccess} disabled={loading || code.length !== 6}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Ionicons name="eye-outline" size={18} color="#fff" />
              <Text style={s.accessBtnText}>Access Live Results</Text>
            </>
          )}
        </Pressable>

        <View style={s.explainCard}>
          <Text style={s.explainTitle}>Observer Privileges</Text>
          <View style={s.explainRow}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.secondary.emerald} />
            <Text style={s.explainText}>View live vote counts and percentages</Text>
          </View>
          <View style={s.explainRow}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.secondary.emerald} />
            <Text style={s.explainText}>Monitor election progress in real time</Text>
          </View>
          <View style={s.explainRow}>
            <Ionicons name="close-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.explainText}>Cannot cast votes or access voter identities</Text>
          </View>
          <View style={s.explainRow}>
            <Ionicons name="close-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.explainText}>Access expires at election close</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  heroSection: { alignItems: 'center', paddingVertical: 32 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  heroSubtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
  readOnlyBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderRadius: 10, padding: 10, marginBottom: 20, justifyContent: 'center', borderWidth: 1, borderColor: '#fde68a' },
  readOnlyText: { fontSize: 13, color: '#92400e', fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  codeInput: { backgroundColor: colors.neutral.surface, borderRadius: 12, borderWidth: 2, borderColor: colors.neutral.border, padding: 16, fontSize: 28, fontWeight: '700', color: colors.neutral.text, marginBottom: 16, letterSpacing: 12 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  accessBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, marginBottom: 24 },
  accessBtnDisabled: { opacity: 0.4 },
  accessBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  explainCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.neutral.border },
  explainTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, marginBottom: 12 },
  explainRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  explainText: { fontSize: 13, color: colors.neutral.textMuted, flex: 1 },
});
