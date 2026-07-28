import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function CreateOrgSuccess() {
  const { name, id } = useLocalSearchParams<{ name?: string; id?: string }>();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}><PartyPopper size={40} color={Colors.teal} strokeWidth={2} /></View>
        <Text style={styles.title}>{name ?? 'Your organisation'} is live!</Text>
        <Text style={styles.sub}>Members can now discover and join. Invite your executives and start adding members.</Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="Open admin console" onPress={() => router.replace('/association/admin')} />
        <PrimaryButton
          label="View organisation"
          variant="ghost"
          onPress={() => router.replace(id ? `/association/organisation/${id}` : '/association')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
});
