import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, Users, ShieldCheck, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';

const POINTS = [
  { icon: Building2, text: 'Model your structure — chapters, branches, committees' },
  { icon: Users, text: 'Set membership categories and approval rules' },
  { icon: Wallet, text: 'Configure dues, registration fees and revenue splits' },
  { icon: ShieldCheck, text: 'Choose how unpaid members are restricted' },
];

export default function CreateOrgIntro() {
  const reset = useOrgDraft((s) => s.reset);

  const start = () => { reset(); router.push('/association/create/basics'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <View style={styles.body}>
        <View style={styles.hero}>
          <Building2 size={32} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Set up your association</Text>
        <Text style={styles.sub}>Stand up a professional, fully-managed organisation in a few steps. You can refine everything later.</Text>

        <View style={styles.points}>
          {POINTS.map((p) => {
            const Icon = p.icon;
            return (
              <View key={p.text} style={styles.pointRow}>
                <View style={styles.pointIcon}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                <Text style={styles.pointText}>{p.text}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Get started" onPress={start} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, gap: Spacing.md },
  hero: { width: 72, height: 72, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  points: { gap: Spacing.md, marginTop: Spacing.sm },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pointIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  pointText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
