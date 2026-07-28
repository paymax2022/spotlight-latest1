import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CreditCard, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';

const CARDS = [
  { id: 'c1', brand: 'Visa', last4: '4242', exp: '08/27' },
  { id: 'c2', brand: 'Mastercard', last4: '5588', exp: '11/26' },
];

export default function PaymentSettings() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment methods" rightSlot={<Pressable hitSlop={8} onPress={() => router.push('/crowdfunding/settings/add-card')} accessibilityLabel="Add card"><Plus size={22} color={Colors.primary} strokeWidth={2.2} /></Pressable>} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Cards saved for faster contributions. Stored securely via our payment provider.</Text>
        {CARDS.map((c) => (
          <View key={c.id} style={styles.card}>
            <View style={styles.iconBox}><CreditCard size={20} color={Colors.secondary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.brand}>{c.brand} •••• {c.last4}</Text>
              <Text style={styles.exp}>Expires {c.exp}</Text>
            </View>
            <Pressable hitSlop={8} accessibilityRole="button"><Text style={styles.remove}>Remove</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60, gap: Spacing.sm },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  brand: { ...Typography.labelLg, color: Colors.onSurface },
  exp: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  remove: { ...Typography.labelMd, color: Colors.error },
});
