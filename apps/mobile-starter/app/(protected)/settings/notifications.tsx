// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const NOTIF_GROUPS = [
  {title:'Visitor',items:[['visitorArrival','Visitor Arrival','Alert when visitor checks in'],['codeExpiry','Code Expiry','Notify before code expires'],['visitorEntry','Visitor Entry','Alert when visitor passes gate']]},
  {title:'Payments',items:[['paymentDue','Payment Due','Remind before due date'],['paymentSuccess','Payment Received','Confirm successful payment'],['overdueAlert','Overdue Alert','Notify when payment overdue']]},
  {title:'Estate',items:[['announcements','Announcements','Estate announcements'],['meetings','Meeting Notices','Upcoming meeting alerts'],['maintenance','Maintenance','Repair and maintenance updates']]},
];
export default function NotificationSettings() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string,boolean>>(Object.fromEntries(NOTIF_GROUPS.flatMap(g=>g.items).map(([k])=>[k,true])));
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Notifications</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        {NOTIF_GROUPS.map((group,gi)=>(
          <View key={gi}>
            <Text style={styles.sectionTitle}>{group.title}</Text>
            <View style={styles.card}>{group.items.map(([key,label,sub],i)=>(
              <View key={key} style={[styles.toggleRow,i>0&&styles.listBorder]}><View style={{flex:1}}><Text style={styles.listTitle}>{label}</Text><Text style={styles.listSub}>{sub}</Text></View><Switch value={settings[key]} onValueChange={v=>setSettings(s=>({...s,[key]:v}))} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
            ))}</View>
          </View>
        ))}
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Save Preferences</Text></Pressable>
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
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderTopWidth:1,borderTopColor:colors.neutral.border},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
