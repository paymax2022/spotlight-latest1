import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { RECENT_BILLERS } from '@/data/billPayment';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';

export default function BeneficiariesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Beneficiaries</Text>
        <View style={styles.iconBtn}>
          <Plus size={20} color={Colors.primary} strokeWidth={2} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Saved billers</Text>
          <Text style={styles.noticeText}>Beneficiaries saved during payment appear here for repeat airtime, data, electricity, and cable purchases.</Text>
        </View>

        <View style={[styles.card, shadow1]}>
          {RECENT_BILLERS.map((biller, index) => (
            <View key={biller.id}>
              <View style={styles.row}>
                <View style={[styles.iconBox, { backgroundColor: biller.bg }]}>
                  <Text style={{ color: biller.accent, fontWeight: '800' }}>{biller.title.slice(0, 1)}</Text>
                </View>
                <View style={styles.copy}>
                  <Text style={styles.title}>{biller.title}</Text>
                  <Text style={styles.sub}>{biller.subtitle}</Text>
                </View>
                <Pressable style={styles.deleteBtn}>
                  <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                </Pressable>
              </View>
              {index < RECENT_BILLERS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <PrimaryButton label="Add Beneficiary" variant="secondary" onPress={() => {}} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.lg },
  notice: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.primaryContainer },
  noticeTitle: { ...Typography.titleMd, color: Colors.primary },
  noticeText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...Typography.labelMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  deleteBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
