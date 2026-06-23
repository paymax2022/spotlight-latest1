// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const CARDS = [{last4:'4521',brand:'Visa',expiry:'12/26'},{last4:'9081',brand:'Mastercard',expiry:'08/25'}];
const ACCOUNTS = [{bank:'GTBank',acct:'**** 4521',name:'Adaeze Okonkwo'}];
export default function PaymentSettings() {
  const router = useRouter();
  const [autopay, setAutopay] = useState(false);
  const [payNotif, setPayNotif] = useState(true);
  const [defaultMethod, setDefaultMethod] = useState('card-4521');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Payment Settings</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Saved Cards</Text>
        <View style={styles.card}>{CARDS.map((c,i)=>(
          <View key={i} style={[styles.listRow,i<CARDS.length-1&&styles.listBorder]}>
            <Ionicons name="card" size={20} color={colors.secondary.DEFAULT}/>
            <View style={{flex:1}}><Text style={styles.listTitle}>{c.brand} ···· {c.last4}</Text><Text style={styles.listSub}>Expires {c.expiry}</Text></View>
            <Pressable style={[styles.radioCircle,defaultMethod===`card-${c.last4}`&&styles.radioCircleActive]}>{defaultMethod===`card-${c.last4}`&&<View style={styles.radioDot}/>}</Pressable>
          </View>
        ))}</View>
        <Text style={styles.sectionTitle}>Saved Accounts</Text>
        <View style={styles.card}>{ACCOUNTS.map((a,i)=>(
          <View key={i} style={styles.listRow}><Ionicons name="business" size={20} color={colors.primary.DEFAULT}/><View style={{flex:1}}><Text style={styles.listTitle}>{a.bank} {a.acct}</Text><Text style={styles.listSub}>{a.name}</Text></View></View>
        ))}</View>
        <View style={styles.card}>
          <View style={styles.toggleRow}><View style={{flex:1}}><Text style={styles.listTitle}>Auto-pay Dues</Text><Text style={styles.listSub}>Automatically settle dues on due date</Text></View><Switch value={autopay} onValueChange={setAutopay} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
          <View style={[styles.toggleRow,styles.listBorder]}><View style={{flex:1}}><Text style={styles.listTitle}>Payment Notifications</Text><Text style={styles.listSub}>Notify on payment events</Text></View><Switch value={payNotif} onValueChange={setPayNotif} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
        </View>
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
  listRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderTopWidth:1,borderTopColor:colors.neutral.border},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  radioCircle:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:colors.neutral.border,alignItems:'center',justifyContent:'center'},
  radioCircleActive:{borderColor:colors.primary.DEFAULT},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.primary.DEFAULT},
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
});
