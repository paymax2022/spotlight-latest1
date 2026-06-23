// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const SESSIONS = [
  {id:'1',device:'iPhone 14 Pro',os:'iOS 17.2',lastActive:'Active now',location:'Lagos, Nigeria',current:true},
  {id:'2',device:'MacBook Air',os:'macOS 14',lastActive:'2h ago',location:'Lagos, Nigeria',current:false},
  {id:'3',device:'iPad Pro',os:'iPadOS 17',lastActive:'3d ago',location:'Abuja, Nigeria',current:false},
];
export default function DeviceManagement() {
  const router = useRouter();
  const [sessions, setSessions] = useState(SESSIONS);
  const signOut = (id: string) => Alert.alert('Sign Out Device','Sign out from this device?',[{text:'Cancel',style:'cancel'},{text:'Sign Out',style:'destructive',onPress:()=>setSessions(s=>s.filter(x=>x.id!==id))}]);
  const signOutAll = () => Alert.alert('Sign Out All','Sign out from all devices?',[{text:'Cancel',style:'cancel'},{text:'Sign Out All',style:'destructive',onPress:()=>setSessions(s=>s.filter(x=>x.current))}]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Active Devices</Text><View style={{ width: 38 }} /></View>
      <FlatList
        data={sessions}
        keyExtractor={i=>i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={()=><View style={{height:10}}/>}
        renderItem={({item})=>(
          <View style={styles.deviceCard}>
            <View style={styles.deviceIcon}><Ionicons name={item.os.includes('iOS')||item.os.includes('iPadOS')?'phone-portrait':'laptop'} size={20} color={colors.primary.DEFAULT}/></View>
            <View style={{flex:1}}>
              <View style={styles.deviceNameRow}><Text style={styles.deviceName}>{item.device}</Text>{item.current&&<View style={styles.currentBadge}><Text style={styles.currentText}>Current</Text></View>}</View>
              <Text style={styles.deviceSub}>{item.os} · {item.lastActive}</Text>
              <Text style={styles.deviceLocation}>{item.location}</Text>
            </View>
            {!item.current&&<Pressable style={styles.signOutBtn} onPress={()=>signOut(item.id)}><Text style={styles.signOutBtnText}>Sign Out</Text></Pressable>}
          </View>
        )}
        ListFooterComponent={<Pressable style={styles.signOutAllBtn} onPress={signOutAll}><Text style={styles.signOutAllText}>Sign Out All Other Devices</Text></Pressable>}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  listContent:{padding:16,gap:0},
  deviceCard:{backgroundColor:colors.neutral.surface,borderRadius:14,padding:14,flexDirection:'row',alignItems:'flex-start',gap:12},
  deviceIcon:{width:40,height:40,borderRadius:12,backgroundColor:colors.primary.DEFAULT+'15',alignItems:'center',justifyContent:'center'},
  deviceNameRow:{flexDirection:'row',alignItems:'center',gap:8},
  deviceName:{fontSize:14,fontWeight:'700',color:colors.neutral.text},
  currentBadge:{backgroundColor:colors.secondary.emerald+'20',paddingHorizontal:8,paddingVertical:2,borderRadius:10},
  currentText:{fontSize:10,fontWeight:'700',color:colors.secondary.emerald},
  deviceSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  deviceLocation:{fontSize:11,color:colors.neutral.placeholder,marginTop:2},
  signOutBtn:{paddingHorizontal:12,paddingVertical:6,borderRadius:8,borderWidth:1,borderColor:colors.secondary.red+'50'},
  signOutBtnText:{fontSize:12,fontWeight:'700',color:colors.secondary.red},
  signOutAllBtn:{backgroundColor:colors.secondary.red+'15',borderRadius:14,height:52,alignItems:'center',justifyContent:'center',marginTop:12,borderWidth:1,borderColor:colors.secondary.red+'30'},
  signOutAllText:{fontSize:15,fontWeight:'700',color:colors.secondary.red},
});
