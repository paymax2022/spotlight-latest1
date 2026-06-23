// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

export default function AutoRenewalScreen() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [savedCard] = useState({ last4: '4242', brand: 'Visa', expiry: '12/26' });

  const handleSave = () => {
    Alert.alert('Saved', `Auto-renewal has been ${enabled ? 'enabled' : 'disabled'}.`, [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Auto-Renewal</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Enable Auto-Renewal</Text>
              <Text style={styles.toggleSub}>Automatically renew your subscription 3 days before expiry</Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
          </View>
        </View>

        {enabled && (
          <>
            <Text style={styles.sectionTitle}>Card on File</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.cardIcon}><Ionicons name="card-outline" size={20} color={colors.primary.DEFAULT} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{savedCard.brand} •••• {savedCard.last4}</Text>
                  <Text style={styles.listSub}>Expires {savedCard.expiry}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={colors.secondary.emerald} />
              </View>
            </View>
            <Pressable style={styles.addCardBtn} onPress={() => router.push('/estate/dues/method/card' as never)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary.DEFAULT} />
              <Text style={styles.addCardText}>Add Different Card</Text>
            </Pressable>
          </>
        )}

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.neutral.textMuted} />
          <Text style={styles.infoText}>You will receive a notification 7 days before your subscription renews. You can cancel at any time.</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleSave}>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral.text },
  toggleSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  addCardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  addCardText: { fontSize: 14, fontWeight: '600', color: colors.primary.DEFAULT },
  infoCard: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 },
  infoText: { fontSize: 12, color: colors.neutral.textMuted, flex: 1, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
