// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const DURATIONS = ['3h','6h','1d','3d'];
export default function VisitorSettings() {
  const router = useRouter();
  const [duration, setDuration] = useState('6h');
  const [autoExpire, setAutoExpire] = useState(true);
  const [arrivalNotif, setArrivalNotif] = useState(true);
  const [gatePhoto, setGatePhoto] = useState(false);
  const [maxCodes, setMaxCodes] = useState(5);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Visitor Settings</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Default Code Duration</Text>
        <View style={styles.durationRow}>{DURATIONS.map(d=>(<Pressable key={d} style={[styles.durationChip,duration===d&&styles.durationChipActive]} onPress={()=>setDuration(d)}><Text style={[styles.durationText,duration===d&&styles.durationTextActive]}>{d}</Text></Pressable>))}</View>
        <View style={styles.card}>
          {[[autoExpire,setAutoExpire,'Auto-expire Old Codes','Expire unused codes automatically'],[arrivalNotif,setArrivalNotif,'Notify on Visitor Arrival','Get alerted when visitor checks in'],[gatePhoto,setGatePhoto,'Require Gate Photo','Guard must take photo at entry']].map(([val,set,title,sub],i)=>(
            <View key={i} style={[styles.toggleRow,i>0&&styles.listBorder]}><View style={{flex:1}}><Text style={styles.listTitle}>{title}</Text><Text style={styles.listSub}>{sub}</Text></View><Switch value={val} onValueChange={set} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
          ))}
        </View>
        <View style={styles.limitRow}><Text style={styles.limitLabel}>Max Active Codes: {maxCodes}</Text><View style={styles.limitBtns}><Pressable style={styles.limitBtn} onPress={()=>setMaxCodes(m=>Math.max(1,m-1))}><Ionicons name="remove" size={18} color={colors.primary.DEFAULT}/></Pressable><Pressable style={styles.limitBtn} onPress={()=>setMaxCodes(m=>Math.min(20,m+1))}><Ionicons name="add" size={18} color={colors.primary.DEFAULT}/></Pressable></View></View>
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Save Settings</Text></Pressable>
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
  sectionTitle:{fontSize:13,fontWeight:'700',color:colors.neutral.textMuted,textTransform:'uppercase',letterSpacing:0.5},
  durationRow:{flexDirection:'row',gap:10},
  durationChip:{flex:1,paddingVertical:12,borderRadius:12,alignItems:'center',backgroundColor:colors.neutral.surface,borderWidth:1.5,borderColor:colors.neutral.border},
  durationChipActive:{backgroundColor:colors.primary.DEFAULT,borderColor:colors.primary.DEFAULT},
  durationText:{fontSize:14,fontWeight:'700',color:colors.neutral.textMuted},
  durationTextActive:{color:'#fff'},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderTopWidth:1,borderTopColor:colors.neutral.border},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  limitRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:colors.neutral.surface,borderRadius:14,padding:14},
  limitLabel:{fontSize:14,fontWeight:'700',color:colors.neutral.text},
  limitBtns:{flexDirection:'row',gap:8},
  limitBtn:{width:38,height:38,borderRadius:10,backgroundColor:colors.neutral.surfaceAlt,alignItems:'center',justifyContent:'center'},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
