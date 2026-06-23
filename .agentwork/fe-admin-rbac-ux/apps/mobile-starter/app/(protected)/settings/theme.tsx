// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const THEMES = [{id:'system',label:'System Default',icon:'phone-portrait'},{id:'light',label:'Light',icon:'sunny'},{id:'dark',label:'Dark',icon:'moon'}];
export default function ThemeSettings() {
  const router = useRouter();
  const [theme, setTheme] = useState('system');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Theme</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.preview}>
          <View style={[styles.previewBox,{backgroundColor:theme==='dark'?'#1a1a2e':'#f8f9ff'}]}><View style={[styles.previewCard,{backgroundColor:theme==='dark'?'#16213e':'#fff'}]}><View style={[styles.previewLine,{backgroundColor:theme==='dark'?'#fff3':'#0b1c3020',width:'70%'}]}/><View style={[styles.previewLine,{backgroundColor:theme==='dark'?'#fff2':'#0b1c3015',width:'50%',marginTop:6}]}/></View></View>
          <Text style={styles.previewLabel}>{THEMES.find(t=>t.id===theme)?.label}</Text>
        </View>
        <View style={styles.card}>{THEMES.map((t,i)=>(
          <Pressable key={t.id} style={[styles.themeRow,i<THEMES.length-1&&styles.listBorder]} onPress={()=>setTheme(t.id)}>
            <View style={styles.themeIcon}><Ionicons name={t.icon as any} size={20} color={colors.primary.DEFAULT}/></View>
            <Text style={[styles.listTitle,{flex:1}]}>{t.label}</Text>
            <View style={[styles.radioCircle,theme===t.id&&styles.radioCircleActive]}>{theme===t.id&&<View style={styles.radioDot}/>}</View>
          </Pressable>
        ))}</View>
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Apply Theme</Text></Pressable>
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
  preview:{backgroundColor:colors.neutral.surface,borderRadius:16,padding:20,alignItems:'center',gap:12},
  previewBox:{width:180,height:100,borderRadius:12,padding:16,justifyContent:'center'},
  previewCard:{borderRadius:10,padding:12},
  previewLine:{height:8,borderRadius:4},
  previewLabel:{fontSize:14,fontWeight:'700',color:colors.neutral.text},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  themeRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  themeIcon:{width:36,height:36,borderRadius:10,backgroundColor:colors.neutral.surfaceAlt,alignItems:'center',justifyContent:'center'},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  radioCircle:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:colors.neutral.border,alignItems:'center',justifyContent:'center'},
  radioCircleActive:{borderColor:colors.primary.DEFAULT},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.primary.DEFAULT},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
