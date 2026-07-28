// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function PropertySettings() {
  const router = useRouter();
  const [notifs, setNotifs] = useState(true);
  const [autopay, setAutopay] = useState(false);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Property Settings</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Primary Property</Text>
        <View style={styles.propCard}><View style={styles.unitBadge}><Text style={styles.unitText}>B12</Text></View><View><Text style={styles.listTitle}>Unit B12 · Apartment</Text><Text style={styles.listSub}>Green Estate</Text></View><Ionicons name="checkmark-circle" size={20} color={colors.secondary.emerald}/></View>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}><View style={{flex:1}}><Text style={styles.listTitle}>Property Notifications</Text><Text style={styles.listSub}>Alerts for your property</Text></View><Switch value={notifs} onValueChange={setNotifs} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
          <View style={[styles.toggleRow,styles.listBorder]}><View style={{flex:1}}><Text style={styles.listTitle}>Auto-pay Dues</Text><Text style={styles.listSub}>Automatically pay estate dues</Text></View><Switch value={autopay} onValueChange={setAutopay} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
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
  propCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.neutral.surface,borderRadius:14,padding:14},
  unitBadge:{width:40,height:40,borderRadius:10,backgroundColor:colors.primary.DEFAULT,alignItems:'center',justifyContent:'center'},
  unitText:{fontSize:12,fontWeight:'800',color:'#fff'},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderTopWidth:1,borderTopColor:colors.neutral.border},
});
