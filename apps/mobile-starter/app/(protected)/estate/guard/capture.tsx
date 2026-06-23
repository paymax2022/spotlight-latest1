// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function CaptureScreen() {
  const router = useRouter();
  const { codeId, gateId } = useLocalSearchParams<{ codeId: string; gateId?: string }>();
  const [plate, setPlate] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  function proceed() {
    router.push({
      pathname: '/estate/guard/visitor-confirm',
      params: { codeId, gateId: gateId ?? '', vehiclePlate: plate, photoUrl },
    } as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Capture Details</Text>
        <Text style={styles.sub}>Capture vehicle and photo before allowing entry.</Text>

        {/* Photo capture placeholder */}
        <Pressable style={styles.photoBox}>
          <Ionicons name="camera-outline" size={48} color={colors.neutral.placeholder} />
          <Text style={styles.photoHint}>Tap to capture visitor photo</Text>
          <Text style={styles.photoNote}>Production: integrate expo-camera</Text>
        </Pressable>

        <Text style={styles.label}>Vehicle Plate (if applicable)</Text>
        <TextInput
          style={styles.input}
          value={plate}
          onChangeText={(v) => setPlate(v.toUpperCase())}
          placeholder="LAS-123-AA"
          placeholderTextColor={colors.neutral.placeholder}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Photo URL (from R2 upload)</Text>
        <TextInput
          style={styles.input}
          value={photoUrl}
          onChangeText={setPhotoUrl}
          placeholder="https://r2.paymax.app/…"
          placeholderTextColor={colors.neutral.placeholder}
          autoCapitalize="none"
          keyboardType="url"
        />

        <Pressable style={styles.continueBtn} onPress={proceed}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
          <Text style={styles.continueBtnText}>Continue to Confirm</Text>
        </Pressable>

        <Pressable style={styles.skipBtn} onPress={() => router.push({ pathname: '/estate/guard/visitor-confirm', params: { codeId, gateId: gateId ?? '' } } as never)}>
          <Text style={styles.skipBtnText}>Skip Capture</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, gap: 14 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted },
  photoBox: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 32, alignItems: 'center', gap: 8, borderWidth: 2, borderColor: '#E2E8F0', borderStyle: 'dashed' },
  photoHint: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
  photoNote: { fontSize: 11, color: colors.neutral.placeholder, fontStyle: 'italic' },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  continueBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
