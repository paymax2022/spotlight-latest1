// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const OCCUPANCY_TYPES = ['resident', 'tenant', 'homeowner', 'landlord'];
const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'members', label: 'Members only' },
  { value: 'admin_only', label: 'Admin only' },
];

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [occupancyType, setOccupancyType] = useState('resident');
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
      if (!ready) {
        setBio(p.bio ?? '');
        setPhone(p.phone ?? '');
        setAltPhone(p.alt_phone ?? '');
        setOccupancyType(p.occupancy_type ?? 'resident');
        setVisibility(p.visibility ?? 'members');
        setReady(true);
      }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return upsertProfile(ctx.estateId, { bio, phone, alt_phone: altPhone, occupancy_type: occupancyType, visibility });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-profile'] });
      Alert.alert('Saved', 'Profile updated successfully.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Save failed'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Edit Profile</Text>

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={bio}
          onChangeText={setBio}
          placeholder="A short bio about yourself"
          placeholderTextColor={colors.neutral.placeholder}
          multiline
          maxLength={300}
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="+234 800 000 0000"
          placeholderTextColor={colors.neutral.placeholder}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Alternate Phone</Text>
        <TextInput
          style={styles.input}
          value={altPhone}
          onChangeText={setAltPhone}
          placeholder="Optional second number"
          placeholderTextColor={colors.neutral.placeholder}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Occupancy Type</Text>
        <View style={styles.chipRow}>
          {OCCUPANCY_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[styles.chip, occupancyType === t && styles.chipActive]}
              onPress={() => setOccupancyType(t)}
            >
              <Text style={[styles.chipText, occupancyType === t && styles.chipTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Profile Visibility</Text>
        <View style={styles.visRow}>
          {VISIBILITY_OPTIONS.map((v) => (
            <Pressable
              key={v.value}
              style={[styles.visOption, visibility === v.value && styles.visOptionActive]}
              onPress={() => setVisibility(v.value)}
            >
              <Ionicons
                name={visibility === v.value ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={visibility === v.value ? colors.primary.DEFAULT : colors.neutral.textMuted}
              />
              <Text style={[styles.visLabel, visibility === v.value && styles.visLabelActive]}>
                {v.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.saveBtn, mutation.isPending && styles.saveBtnDisabled]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Changes</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 6 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  textarea: { height: 100, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  chipTextActive: { color: '#fff' },
  visRow: { gap: 8, marginTop: 4 },
  visOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  visOptionActive: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.primary.DEFAULT + '08' },
  visLabel: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '500' },
  visLabelActive: { color: colors.primary.DEFAULT, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
