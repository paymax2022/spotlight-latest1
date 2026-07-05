import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Clock, Calculator } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import { LEARN_TOPICS } from '@/features/fractionalre/constants';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function LearnHub() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Learn" subtitle="Understand fractional real estate" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <RiskRibbon compact />

        {LEARN_TOPICS.map((t) => {
          const Glyph = (Icons as unknown as Record<string, Icons.LucideIcon>)[t.icon] ?? Icons.BookOpen;
          return (
            <View key={t.id} style={styles.row}>
              <View style={styles.iconBox}><Glyph size={20} color={Colors.teal} strokeWidth={2} /></View>
              <View style={styles.text}>
                <Text style={styles.title}>{t.title}</Text>
                <View style={styles.metaRow}>
                  <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.meta}>{t.minutes} min read</Text>
                </View>
              </View>
            </View>
          );
        })}

        <Pressable style={styles.calcBtn} onPress={() => router.push('/fractionalre/market')}>
          <Calculator size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.calcText}>Try the returns calculator on any opportunity</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  calcBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  calcText: { ...Typography.labelMd, color: Colors.primary, flex: 1 },
});
