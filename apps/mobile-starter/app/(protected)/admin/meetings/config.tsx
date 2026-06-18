// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function MeetingsConfig() {
  const router = useRouter();
  const [quorum, setQuorum] = useState('51');
  const [rsvpHours, setRsvpHours] = useState('24');
  const [recording, setRecording] = useState(true);
  const [minutesApproval, setMinutesApproval] = useState(true);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Rules</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Quorum Percentage (%)</Text>
            <TextInput style={styles.input} value={quorum} onChangeText={setQuorum} keyboardType="numeric" />
          </View>
          <View style={[styles.fieldWrap, styles.listBorder]}>
            <Text style={styles.label}>RSVP Deadline (hours before meeting)</Text>
            <TextInput style={styles.input} value={rsvpHours} onChangeText={setRsvpHours} keyboardType="numeric" />
          </View>
          <View style={[styles.toggleRow, styles.listBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Recording Allowed</Text>
              <Text style={styles.listSub}>Allow meeting recordings</Text>
            </View>
            <Switch value={recording} onValueChange={setRecording} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
          </View>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Minutes Approval Required</Text>
              <Text style={styles.listSub}>Meeting minutes must be approved before publishing</Text>
            </View>
            <Switch value={minutesApproval} onValueChange={setMinutesApproval} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
          </View>
        </View>
        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Settings</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  fieldWrap: { padding: 14, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
