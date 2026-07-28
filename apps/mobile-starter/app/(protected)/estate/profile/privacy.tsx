// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    desc: 'Anyone can view your profile name and contact.',
    icon: 'globe-outline',
    color: '#3B82F6',
  },
  {
    value: 'members',
    label: 'Members Only',
    desc: 'Only fellow estate residents can see your profile.',
    icon: 'people-outline',
    color: '#10B981',
  },
  {
    value: 'admin_only',
    label: 'Admin Only',
    desc: 'Only estate admins can view your profile details.',
    icon: 'lock-closed-outline',
    color: '#6C63FF',
  },
];

export default function PrivacyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState('members');
  const [ready, setReady] = useState(false);

  useQuery({
    queryKey: ['estate-profile'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getProfile(ctx.estateId);
    },
    onSuccess: (p) => {
      if (!ready) { setVisibility(p.visibility ?? 'members'); setReady(true); }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return upsertProfile(ctx.estateId, { visibility });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-profile'] });
      Alert.alert('Saved', 'Privacy settings updated.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Save failed'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Privacy Settings</Text>
        <Text style={styles.sub}>Control who can see your profile information within the estate.</Text>

        <View style={styles.optionList}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const selected = visibility === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.option, selected && styles.optionSelected, selected && { borderColor: opt.color }]}
                onPress={() => setVisibility(opt.value)}
              >
                <View style={[styles.optIcon, { backgroundColor: opt.color + '18' }]}>
                  <Ionicons name={opt.icon as any} size={22} color={opt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optLabel, selected && { color: opt.color }]}>{opt.label}</Text>
                  <Text style={styles.optDesc}>{opt.desc}</Text>
                </View>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? opt.color : colors.neutral.placeholder}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.noteBox}>
          <Ionicons name="information-circle-outline" size={16} color="#6C63FF" />
          <Text style={styles.noteText}>
            Emergency contacts and next-of-kin are always visible to estate admins regardless of this setting.
          </Text>
        </View>

        <Pressable
          style={[styles.saveBtn, mutation.isPending && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Privacy Settings</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 20 },
  optionList: { gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 2, borderColor: '#E2E8F0' },
  optionSelected: { backgroundColor: '#FAFAFE' },
  optIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optLabel: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  optDesc: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, lineHeight: 17 },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 10, padding: 14 },
  noteText: { flex: 1, fontSize: 12, color: '#6C63FF', lineHeight: 18 },
  saveBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
