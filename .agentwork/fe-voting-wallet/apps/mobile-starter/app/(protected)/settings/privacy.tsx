// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const VISIBILITY = ['Public','Members Only','Admin Only'];
export default function PrivacySettings() {
  const router = useRouter();
  const [visibility, setVisibility] = useState('Members Only');
  const [lastSeen, setLastSeen] = useState(true);
  const [showUnit, setShowUnit] = useState(false);
  const [dataConsent, setDataConsent] = useState(true);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Privacy</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Profile Visibility</Text>
        <View style={styles.card}>{VISIBILITY.map((v,i)=>(
          <Pressable key={v} style={[styles.radioRow,i<VISIBILITY.length-1&&styles.listBorder]} onPress={()=>setVisibility(v)}>
            <View style={[styles.radioCircle,visibility===v&&styles.radioCircleActive]}>{visibility===v&&<View style={styles.radioDot}/>}</View>
            <Text style={styles.listTitle}>{v}</Text>
          </Pressable>
        ))}</View>
        <Text style={styles.sectionTitle}>Visibility Options</Text>
        <View style={styles.card}>
          {[[lastSeen,setLastSeen,'Show Last Seen'],[showUnit,setShowUnit,'Show Unit Number'],[dataConsent,setDataConsent,'Data Usage Consent']].map(([val,set,label],i)=>(
            <View key={i} style={[styles.toggleRow,i>0&&styles.listBorder]}><Text style={[styles.listTitle,{flex:1}]}>{label}</Text><Switch value={val} onValueChange={set} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
          ))}
        </View>
        <Pressable style={styles.downloadBtn}><Ionicons name="download-outline" size={16} color={colors.secondary.DEFAULT}/><Text style={styles.downloadBtnText}>Download My Data</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:12},
  sectionTitle:{fontSize:13,fontWeight:'700',color:colors.neutral.textMuted,textTransform:'uppercase',letterSpacing:0.5},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  radioRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderTopWidth:1,borderTopColor:colors.neutral.border},
  radioCircle:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:colors.neutral.border,alignItems:'center',justifyContent:'center'},
  radioCircleActive:{borderColor:colors.primary.DEFAULT},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.primary.DEFAULT},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  downloadBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,height:52,borderRadius:14,borderWidth:1.5,borderColor:colors.secondary.DEFAULT},
  downloadBtnText:{fontSize:15,fontWeight:'700',color:colors.secondary.DEFAULT},
});
