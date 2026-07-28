// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lookupCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function ScanScreen() {
  const router = useRouter();
  const { gateId } = useLocalSearchParams<{ gateId?: string }>();
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);

  const lookup = useMutation({
    mutationFn: async (code: string) => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return lookupCode(ctx.estateId, { numeric_code: code });
    },
    onSuccess: (payload) => {
      if (payload.blacklisted) {
        router.replace({ pathname: '/estate/guard/blacklist-alert', params: { codeId: payload.code.id } } as never);
        return;
      }
      router.push({ pathname: '/estate/guard/visitor-confirm', params: { codeId: payload.code.id, gateId: gateId ?? '' } } as never);
    },
    onError: (e: any) => Alert.alert('Not Found', e?.message ?? 'Code not found or expired'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Scan Visitor Code</Text>

        {/* Camera viewfinder placeholder */}
        <View style={styles.viewfinder}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <Text style={styles.scanHint}>
            {scanning ? 'Scanning…' : 'Point camera at QR code'}
          </Text>
          {/* Production: replace with <CameraView> from expo-camera */}
          <Ionicons name="qr-code-outline" size={80} color="rgba(255,255,255,0.3)" style={{ marginTop: 12 }} />
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or enter manually</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.manualRow}>
          <TextInput
            style={styles.codeInput}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="6-digit code"
            placeholderTextColor={colors.neutral.placeholder}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Pressable
            style={[styles.lookupBtn, (!manualCode || lookup.isPending) && styles.disabled]}
            onPress={() => lookup.mutate(manualCode)}
            disabled={!manualCode || lookup.isPending}
          >
            <Ionicons name="search" size={22} color="#fff" />
          </Pressable>
        </View>

        <Pressable style={styles.manualFullBtn} onPress={() => router.push('/estate/guard/manual' as never)}>
          <Text style={styles.manualFullBtnText}>Manual Lookup →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F172A' },
  container: { flex: 1, padding: 24, gap: 20, alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 8 },
  viewfinder: { width: 280, height: 280, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  scanFrame: { ...StyleSheet.absoluteFillObject, margin: 20 },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: '#fff', borderWidth: CORNER_WIDTH },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanHint: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 8, position: 'absolute', bottom: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  dividerText: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  manualRow: { flexDirection: 'row', gap: 10, width: '100%' },
  codeInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, fontSize: 22, color: '#fff', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center', letterSpacing: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  lookupBtn: { width: 54, height: 54, borderRadius: 12, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  manualFullBtn: { paddingVertical: 10 },
  manualFullBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
});
