// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const SECTIONS = ['1. Acceptance of Terms','2. Use of Services','3. User Responsibilities','4. Payments and Fees','5. Privacy','6. Intellectual Property','7. Limitation of Liability','8. Changes to Terms'];
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
export default function Terms() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Terms of Service</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lastUpdated}>Last updated: December 15, 2024</Text>
        {SECTIONS.map((s,i)=>(<View key={i} style={styles.section}><Text style={styles.sectionTitle}>{s}</Text><Text style={styles.sectionBody}>{LOREM}</Text></View>))}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:16},
  lastUpdated:{fontSize:12,color:colors.neutral.placeholder,textAlign:'center'},
  section:{gap:8},
  sectionTitle:{fontSize:15,fontWeight:'700',color:colors.neutral.text},
  sectionBody:{fontSize:13,color:colors.neutral.textMuted,lineHeight:22},
});
