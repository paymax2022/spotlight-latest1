// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

function ContactSection({ title, value, onChange }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TextInput
        style={styles.input}
        value={value.name ?? ''}
        onChangeText={(v) => onChange({ ...value, name: v })}
        placeholder="Full name"
        placeholderTextColor={colors.neutral.placeholder}
      />
      <TextInput
        style={styles.input}
        value={value.phone ?? ''}
        onChangeText={(v) => onChange({ ...value, phone: v })}
        placeholder="Phone number"
        placeholderTextColor={colors.neutral.placeholder}
        keyboardType="phone-pad"
      />
      <TextInput
        style={styles.input}
        value={value.relationship ?? ''}
        onChangeText={(v) => onChange({ ...value, relationship: v })}
        placeholder="Relationship (e.g. Spouse, Parent)"
        placeholderTextColor={colors.neutral.placeholder}
      />
      <TextInput
        style={styles.input}
        value={value.address ?? ''}
        onChangeText={(v) => onChange({ ...value, address: v })}
        placeholder="Address (optional)"
        placeholderTextColor={colors.neutral.placeholder}
      />
    </View>
  );
}

export default function ContactsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ec, setEc] = useState({});
  const [nok, setNok] = useState({});
  const [ready, setReady] = useState(false);

  useQuery({
    queryKey: ['estate-profile'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getProfile(ctx.estateId);
    },
    onSuccess: (p) => {
      if (!ready) {
        setEc(p.emergency_contact ?? {});
        setNok(p.next_of_kin ?? {});
        setReady(true);
      }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return upsertProfile(ctx.estateId, { emergency_contact: ec, next_of_kin: nok });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-profile'] });
      Alert.alert('Saved', 'Contacts updated.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Save failed'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Emergency Contacts</Text>
        <Text style={styles.sub}>These details help estate security and management in emergencies.</Text>

        <ContactSection title="Emergency Contact" value={ec} onChange={setEc} />
        <ContactSection title="Next of Kin" value={nok} onChange={setNok} />

        <Pressable
          style={[styles.saveBtn, mutation.isPending && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Contacts</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 12 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 20, marginBottom: 4 },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 4 },
  input: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  saveBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
