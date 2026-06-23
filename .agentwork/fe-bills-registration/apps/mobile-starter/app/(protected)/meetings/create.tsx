// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const TYPES = ['physical', 'virtual', 'hybrid'] as const;

export default function CreateMeeting() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState<'physical'|'virtual'|'hybrid'>('physical');
  const [agenda, setAgenda] = useState('');

  const mut = useMutation({
    mutationFn: () => createMeeting(estateId, { title, date, time, location, type, agenda }),
    onSuccess: () => {
      Alert.alert('Success', 'Meeting created successfully');
      qc.invalidateQueries({ queryKey: ['meetings', estateId] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Failed to create meeting'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Create Meeting</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Meeting Title *</Text>
          <TextInput style={styles.input} placeholder="Enter meeting title" placeholderTextColor={colors.neutral.placeholder} value={title} onChangeText={setTitle} />
        </View>

        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2025-01-15" placeholderTextColor={colors.neutral.placeholder} value={date} onChangeText={setDate} />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Time (HH:MM)</Text>
            <TextInput style={styles.input} placeholder="10:00" placeholderTextColor={colors.neutral.placeholder} value={time} onChangeText={setTime} />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Meeting Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map(t => (
              <Pressable key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)}>
                <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {(type === 'physical' || type === 'hybrid') ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Location</Text>
            <TextInput style={styles.input} placeholder="Enter venue or address" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Agenda</Text>
          <TextInput style={[styles.input, styles.textarea]} placeholder="Describe the meeting agenda..." placeholderTextColor={colors.neutral.placeholder} value={agenda} onChangeText={setAgenda} multiline numberOfLines={4} textAlignVertical="top" />
        </View>

        <Pressable style={[styles.primaryBtn, mut.isPending && { opacity: 0.6 }]} onPress={() => mut.mutate()} disabled={mut.isPending || !title.trim() || !date.trim() || !time.trim()}>
          <Text style={styles.primaryBtnText}>{mut.isPending ? 'Creating...' : 'Create Meeting'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  fieldGroup: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 110, paddingTop: 14 },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center', backgroundColor: colors.neutral.surface },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
