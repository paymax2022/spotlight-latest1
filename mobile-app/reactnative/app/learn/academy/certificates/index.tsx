import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GraduationCap, Wrench, ChevronRight, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useCredentials } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/** G10 — My certificates: academic + trade credentials. */
export default function CertificatesScreen() {
  const creds = useCredentials();
  if (creds.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading certificates…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My certificates" subtitle="Verifiable credentials" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {creds.data?.length ? creds.data.map((c) => {
          const Icon = c.kind === 'trade' ? Wrench : GraduationCap;
          return (
            <Pressable key={c.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/certificates/${c.id}`)}>
              <View style={[styles.icon, c.kind === 'trade' && { backgroundColor: Colors.iconBgGold }]}>
                <Icon size={20} color={c.kind === 'trade' ? Colors.gold : Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{c.title}</Text>
                <Text style={styles.sub}>{c.issuer}</Text>
                <View style={styles.metaRow}>
                  <Chip label={c.kind === 'trade' ? 'Trade' : 'Academic'} color={c.kind === 'trade' ? Colors.gold : Colors.secondary} bg={c.kind === 'trade' ? Colors.iconBgGold : Colors.iconBgBlue} small />
                  <View style={styles.verifyTag}><ShieldCheck size={12} color={Colors.teal} /><Text style={styles.verifyText}>Verifiable</Text></View>
                  <Text style={styles.date}>{formatDate(c.issuedAt)}</Text>
                </View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          );
        }) : (
          <StateView kind="empty" icon="Award" title="No certificates yet" message="Pass a skill assessment or exam to earn your first verifiable credential." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  verifyTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifyText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' },
  date: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
