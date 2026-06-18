// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function JobCheckin() {
  const router = useRouter();
  const [generated, setGenerated] = useState(false);
  const code = 'VND-4872';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Check-in</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.jobCard}>
          <Ionicons name="construct" size={24} color={colors.primary.DEFAULT} />
          <View>
            <Text style={styles.jobTitle}>Electrical panel repair</Text>
            <Text style={styles.jobSub}>Green Estate · Job #1042</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Generate a one-time gate pass code to check in at the estate gate. Show this code to the security guard.</Text>
        </View>

        {!generated ? (
          <Pressable style={styles.primaryBtn} onPress={() => setGenerated(true)}>
            <Ionicons name="key-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Generate Gate Pass</Text>
          </Pressable>
        ) : (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Your Gate Pass Code</Text>
            <Text style={styles.code}>{code}</Text>
            <Text style={styles.codeExpiry}>Valid for 2 hours · Expires at 4:30 PM</Text>
            <View style={styles.codeDivider} />
            <Text style={styles.codeInstruction}>Show this code to the guard at the gate. It can only be used once.</Text>
          </View>
        )}

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>Check-in Steps</Text>
          {[
            'Generate your gate pass code above',
            'Arrive at the estate main gate',
            'Show code to the security guard',
            'Guard verifies and logs your entry',
            'Proceed to the job location',
          ].map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
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
  jobCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  jobTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  jobSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  infoCard: { flexDirection: 'row', gap: 10, backgroundColor: colors.secondary.DEFAULT + '10', borderRadius: 12, padding: 14 },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  codeCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.06, elevation: 3 },
  codeLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  code: { fontSize: 36, fontWeight: '900', color: colors.primary.DEFAULT, letterSpacing: 6 },
  codeExpiry: { fontSize: 12, color: colors.secondary.amber, fontWeight: '600' },
  codeDivider: { width: '80%', height: 1, backgroundColor: colors.neutral.border, marginVertical: 4 },
  codeInstruction: { fontSize: 12, color: colors.neutral.textMuted, textAlign: 'center' },
  stepsCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, gap: 10 },
  stepsTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, marginBottom: 4 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 11, fontWeight: '800', color: colors.primary.DEFAULT },
  stepText: { flex: 1, fontSize: 13, color: colors.neutral.textMuted, lineHeight: 20 },
});
