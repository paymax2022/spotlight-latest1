// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function BannedScreen() {
  const router = useRouter();
  const outstandingBalance = '₦125,000';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="ban" size={80} color="#dc2626" />
          </View>
        </View>

        <AppCard style={styles.card}>
          <AppText variant="h1" style={styles.title}>Access Restricted</AppText>
          <AppText variant="body" style={styles.body}>
            Your access has been restricted due to outstanding financial obligations to the estate.
          </AppText>

          <View style={styles.balanceBox}>
            <AppText variant="caption" style={styles.balanceLabel}>Outstanding Balance</AppText>
            <Text style={styles.balanceAmount}>{outstandingBalance}</Text>
            <AppText variant="caption" style={styles.balanceNote}>
              Service charges, levies, and penalties
            </AppText>
          </View>

          <AppText variant="caption" style={styles.note}>
            Please clear your outstanding balance to restore full estate access.
          </AppText>
        </AppCard>

        <View style={styles.actions}>
          <AppButton
            title="Pay Now"
            variant="primary"
            onPress={() => {}}
          />
          <AppButton
            title="Contact Support"
            variant="ghost"
            onPress={() => {}}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 16, alignItems: 'center' },
  iconSection: { paddingTop: 24 },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: 14, alignSelf: 'stretch' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: colors.neutral.textMuted },
  balanceBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  balanceLabel: { color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 },
  balanceAmount: { fontSize: 32, fontWeight: '800', color: '#dc2626' },
  balanceNote: { color: colors.neutral.textMuted },
  note: { color: colors.neutral.textMuted, textAlign: 'center' },
  actions: { gap: 12, alignSelf: 'stretch' },
});
