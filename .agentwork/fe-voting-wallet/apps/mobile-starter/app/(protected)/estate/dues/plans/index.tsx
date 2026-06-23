// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const PLANS = [
  { id: 'monthly', label: 'Monthly', amount: 1500000, period: '/mo', savings: null, color: colors.secondary.DEFAULT },
  { id: 'quarterly', label: 'Quarterly', amount: 4275000, period: '/3mo', savings: 'Save 5%', color: '#8B5CF6' },
  { id: 'annual', label: 'Annual', amount: 15300000, period: '/yr', savings: 'Save 15%', color: colors.secondary.emerald },
];

const CURRENT_PLAN = 'monthly';

export default function PlansScreen() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState(CURRENT_PLAN);
  const [autoRenewal, setAutoRenewal] = useState(true);

  const handleChange = () => {
    if (selectedPlan === CURRENT_PLAN) {
      Alert.alert('No Change', 'You are already on this plan.');
      return;
    }
    Alert.alert('Plan Changed', `Your subscription plan has been updated to ${PLANS.find(p => p.id === selectedPlan)?.label}.`, [{ text: 'OK' }]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Subscription Plans</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {PLANS.map((plan) => {
          const isCurrent = plan.id === CURRENT_PLAN;
          const isSelected = plan.id === selectedPlan;
          return (
            <Pressable
              key={plan.id}
              style={[styles.planCard, isSelected && styles.planCardSelected, isCurrent && styles.planCardCurrent]}
              onPress={() => setSelectedPlan(plan.id)}
            >
              {isCurrent && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current Plan</Text></View>}
              {plan.savings && !isCurrent && (
                <View style={[styles.savingsBadge, { backgroundColor: plan.color }]}>
                  <Text style={styles.savingsBadgeText}>{plan.savings}</Text>
                </View>
              )}
              <Text style={[styles.planLabel, isSelected && { color: plan.color }]}>{plan.label}</Text>
              <Text style={styles.planAmount}>{fmt(plan.amount)}<Text style={styles.planPeriod}>{plan.period}</Text></Text>
              <View style={[styles.radio, isSelected && { borderColor: plan.color }]}>
                {isSelected && <View style={[styles.radioDot, { backgroundColor: plan.color }]} />}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.autoRenewalCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.autoLabel}>Auto-Renewal</Text>
            <Text style={styles.autoSub}>Automatically renew your subscription before expiry</Text>
          </View>
          <Switch value={autoRenewal} onValueChange={setAutoRenewal} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
        </View>

        <Pressable style={[styles.primaryBtn, selectedPlan === CURRENT_PLAN && styles.primaryBtnDisabled]} onPress={handleChange}>
          <Text style={styles.primaryBtnText}>Change Plan</Text>
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
  planCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 20, borderWidth: 2, borderColor: colors.neutral.border, position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  planCardSelected: { borderColor: colors.primary.DEFAULT },
  planCardCurrent: { backgroundColor: colors.neutral.surfaceAlt },
  currentBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: colors.primary.DEFAULT, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  currentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  savingsBadge: { position: 'absolute', top: 12, right: 12, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  savingsBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  planLabel: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 4 },
  planAmount: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  planPeriod: { fontSize: 14, fontWeight: '400', color: colors.neutral.textMuted },
  radio: { position: 'absolute', bottom: 16, right: 16, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  autoRenewalCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  autoLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral.text },
  autoSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
