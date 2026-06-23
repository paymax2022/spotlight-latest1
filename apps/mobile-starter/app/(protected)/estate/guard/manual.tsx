// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lookupCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function ManualLookupScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');

  const lookup = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return lookupCode(ctx.estateId, { numeric_code: code.trim() });
    },
    onSuccess: (payload) => {
      if (payload.blacklisted) {
        router.push({ pathname: '/estate/guard/blacklist-alert', params: { codeId: payload.code.id } } as never);
        return;
      }
      router.push({ pathname: '/estate/guard/visitor-confirm', params: { codeId: payload.code.id } } as never);
    },
    onError: (e: any) => Alert.alert('Not Found', e?.message ?? 'Code not found or invalid'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Manual Code Lookup</Text>
        <Text style={styles.sub}>Enter the 6-digit numeric code shown on the visitor's phone.</Text>

        <View style={styles.inputRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[styles.digit, code[i] && styles.digitFilled]}>
              <Text style={styles.digitText}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </View>

        <TextInput
          style={styles.hiddenInput}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
        />

        <Pressable
          style={[styles.lookupBtn, (code.length < 6 || lookup.isPending) && styles.disabled]}
          onPress={() => lookup.mutate()}
          disabled={code.length < 6 || lookup.isPending}
        >
          {lookup.isPending
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="search" size={20} color="#fff" />
                <Text style={styles.lookupBtnText}>Look Up Code</Text>
              </>
          }
        </Pressable>

        <Pressable style={styles.clearBtn} onPress={() => setCode('')}>
          <Text style={styles.clearBtnText}>Clear</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, gap: 20, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  inputRow: { flexDirection: 'row', gap: 10 },
  digit: { width: 48, height: 60, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 2, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  digitFilled: { backgroundColor: colors.primary.DEFAULT + '12', borderColor: colors.primary.DEFAULT },
  digitText: { fontFamily: 'monospace', fontSize: 24, fontWeight: '900', color: colors.primary.DEFAULT },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  lookupBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 16, marginTop: 8 },
  lookupBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.4 },
  clearBtn: { paddingVertical: 8 },
  clearBtnText: { fontSize: 14, color: colors.neutral.textMuted },
});
