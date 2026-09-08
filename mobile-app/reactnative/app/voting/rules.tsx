import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import VotingRulesCard from '@/features/voting/components/VotingRulesCard';

export default function VotingRulesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Voting Rules & Policies</Text>
        <Pressable onPress={() => goBack('/voting')} style={styles.closeBtn}>
          <X size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Please read the following rules carefully before participating in any Spotlight contest.
          By voting, you agree to these terms.
        </Text>
        <VotingRulesCard />
        <View style={styles.termsRow}>
          <Text style={styles.termsText}>
            For full terms and conditions, visit{' '}
            <Text style={styles.termsLink}>spotlight.ng/terms</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  title:   { ...Typography.titleLg, color: Colors.onSurface },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 60 },
  intro:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  termsRow: { paddingTop: Spacing.sm },
  termsText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  termsLink: { color: Colors.primary, fontWeight: '600' as const },
});
