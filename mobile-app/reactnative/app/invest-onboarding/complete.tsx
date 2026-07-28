import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PartyPopper, Bitcoin, LineChart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function OnboardingCompleteScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <View style={styles.ring}>
          <PartyPopper size={64} color={Colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>You're all set</Text>
        <Text style={styles.sub}>
          Your invest account is ready. Once verification is approved you can fund your wallet and
          start investing in products that match your profile.
        </Text>

        <View style={styles.cards}>
          <View style={styles.card}>
            <Bitcoin size={22} color={'#F7931A'} strokeWidth={2} />
            <Text style={styles.cardTitle}>Crypto</Text>
            <Text style={styles.cardSub}>Buy and hold major coins</Text>
          </View>
          <View style={styles.card}>
            <LineChart size={22} color={'#16A34A'} strokeWidth={2} />
            <Text style={styles.cardTitle}>Stocks</Text>
            <Text style={styles.cardSub}>Own shares & ETFs</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Explore crypto" onPress={() => router.dismissTo('/crypto')} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton label="Explore stocks" variant="secondary" onPress={() => router.dismissTo('/stocks')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 120, height: 120, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  cards: { flexDirection: 'row', gap: Spacing.md, alignSelf: 'stretch', marginTop: Spacing.md },
  card: {
    flex: 1, gap: 4,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  cardSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
