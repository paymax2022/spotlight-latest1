// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function ElectionRules() {
  const router = useRouter();

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Election Rules</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.section}>
          <Text style={s.sectionTitle}>Voter Eligibility</Text>
          <Text style={s.bodyText}>
            To be eligible to vote in this election, you must:{'\n\n'}
            1. Be a registered resident or property owner in the estate.{'\n'}
            2. Have no outstanding service charge or estate dues.{'\n'}
            3. Have completed your identity verification (KYC).{'\n'}
            4. Be of adult age (18 years and above).{'\n\n'}
            Eligibility is verified automatically when you attempt to cast your vote. If you believe there is an error in your eligibility status, please contact the estate management office.
          </Text>
        </View>

        <View style={s.divider} />

        <View style={s.section}>
          <Text style={s.sectionTitle}>Campaign Rules</Text>
          <Text style={s.bodyText}>
            Candidates must adhere to the following campaign guidelines:{'\n\n'}
            1. Campaign materials must be approved by the electoral committee before distribution.{'\n'}
            2. Canvassing is prohibited within 50 metres of the polling area.{'\n'}
            3. No candidate may offer gifts, inducements, or bribes to voters.{'\n'}
            4. Campaign spending is capped at the limit set by the association.{'\n'}
            5. Negative campaigning or defamatory statements about opponents are prohibited.{'\n\n'}
            Violation of campaign rules may result in disqualification.
          </Text>
        </View>

        <View style={s.divider} />

        <View style={s.section}>
          <Text style={s.sectionTitle}>Voting Process</Text>
          <Text style={s.bodyText}>
            The voting process is conducted electronically through the Paymax app:{'\n\n'}
            1. Each eligible voter may cast exactly one vote per position.{'\n'}
            2. Votes are encrypted and stored securely.{'\n'}
            3. Your candidate choices are confidential — only the fact that you voted is recorded.{'\n'}
            4. Votes cannot be changed once submitted.{'\n'}
            5. The election closes automatically at the scheduled end time.
          </Text>
        </View>

        <View style={s.divider} />

        <View style={s.section}>
          <Text style={s.sectionTitle}>Dispute Process</Text>
          <Text style={s.bodyText}>
            Disputes regarding election conduct or results must be submitted within 48 hours of results announcement:{'\n\n'}
            1. Submit a formal dispute via the Dispute form in the app.{'\n'}
            2. Disputes are reviewed by the Electoral Committee within 48 hours.{'\n'}
            3. Decisions of the Electoral Committee are final and binding.{'\n'}
            4. False or malicious complaints may result in sanctions.{'\n\n'}
            For urgent matters, contact the estate management office directly.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 20, paddingBottom: 60 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 10 },
  bodyText: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 23 },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginBottom: 20 },
});
