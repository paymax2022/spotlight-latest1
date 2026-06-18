// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const FAQS = [
  {cat:'Payments',items:[['How do I pay estate dues?','Go to Payments tab, tap Pay Dues, select your preferred method.'],['What happens if I miss payment?','You may have visitor code restrictions until dues are cleared.'],['Can I set up auto-pay?','Yes, enable auto-pay in Settings > Payment Settings.']]},
  {cat:'Visitors',items:[['How do I create a visitor code?','Tap the + button on the Visitors tab to generate a code.'],['How long is a code valid?','Default 6 hours. Adjust in Settings > Visitor Settings.'],['Can I revoke a code?','Yes, tap any active code and select Revoke.']]},
  {cat:'Account',items:[['How do I change my password?','Settings > Security > Change Password.'],['How do I update my profile?','Settings > Account > Profile.']]},
];
export default function FAQs() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string|null>(null);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>FAQs</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        {FAQS.map((group,gi)=>(
          <View key={gi}>
            <Text style={styles.sectionTitle}>{group.cat}</Text>
            <View style={styles.card}>{group.items.map(([q,a],i)=>(
              <Pressable key={i} style={[styles.faqRow,i<group.items.length-1&&styles.listBorder]} onPress={()=>setExpanded(expanded===`${gi}-${i}`?null:`${gi}-${i}`)}>
                <View style={styles.faqQ}><Text style={styles.qText}>{q}</Text><Ionicons name={expanded===`${gi}-${i}`?'chevron-up':'chevron-down'} size={16} color={colors.neutral.placeholder}/></View>
                {expanded===`${gi}-${i}`&&<Text style={styles.aText}>{a}</Text>}
              </Pressable>
            ))}</View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:10},
  sectionTitle:{fontSize:13,fontWeight:'700',color:colors.neutral.textMuted,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  faqRow:{padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  faqQ:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  qText:{flex:1,fontSize:14,fontWeight:'600',color:colors.neutral.text,paddingRight:8},
  aText:{fontSize:13,color:colors.neutral.textMuted,marginTop:8,lineHeight:20},
});
