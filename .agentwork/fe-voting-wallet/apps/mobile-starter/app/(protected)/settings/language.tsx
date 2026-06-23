// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const LANGS = [{code:'en',label:'English',available:true},{code:'yo',label:'Yoruba',available:false},{code:'ig',label:'Igbo',available:false},{code:'ha',label:'Hausa',available:false},{code:'pc',label:'Pidgin',available:false}];
export default function LanguageSettings() {
  const router = useRouter();
  const [lang, setLang] = useState('en');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Language</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>{LANGS.map((l,i)=>(
          <Pressable key={l.code} style={[styles.langRow,i<LANGS.length-1&&styles.listBorder]} onPress={()=>l.available&&setLang(l.code)} disabled={!l.available}>
            <View style={[styles.radioCircle,lang===l.code&&styles.radioCircleActive]}>{lang===l.code&&<View style={styles.radioDot}/>}</View>
            <Text style={[styles.langLabel,!l.available&&{color:colors.neutral.placeholder}]}>{l.label}</Text>
            {!l.available&&<View style={styles.soonBadge}><Text style={styles.soonText}>Soon</Text></View>}
          </Pressable>
        ))}</View>
        <View style={styles.noteCard}><Ionicons name="information-circle-outline" size={16} color={colors.secondary.DEFAULT}/><Text style={styles.noteText}>Translations for Yoruba, Igbo, Hausa, and Pidgin are coming soon.</Text></View>
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Save</Text></Pressable>
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
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  langRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  radioCircle:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:colors.neutral.border,alignItems:'center',justifyContent:'center'},
  radioCircleActive:{borderColor:colors.primary.DEFAULT},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.primary.DEFAULT},
  langLabel:{flex:1,fontSize:15,fontWeight:'600',color:colors.neutral.text},
  soonBadge:{backgroundColor:colors.neutral.surfaceAlt,paddingHorizontal:8,paddingVertical:3,borderRadius:10},
  soonText:{fontSize:11,fontWeight:'600',color:colors.neutral.textMuted},
  noteCard:{flexDirection:'row',gap:8,backgroundColor:colors.secondary.DEFAULT+'10',borderRadius:12,padding:12},
  noteText:{flex:1,fontSize:12,color:colors.neutral.text,lineHeight:18},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
