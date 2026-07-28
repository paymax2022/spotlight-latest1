// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const TOPICS = ['Getting Started','Visitor Codes','Payments & Dues','Security','Account Settings','Technical Issues'];
export default function HelpCenter() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Help Center</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchWrap}><Ionicons name="search" size={16} color={colors.neutral.placeholder} style={{marginRight:8}}/><TextInput style={styles.searchInput} placeholder="Search help..." placeholderTextColor={colors.neutral.placeholder} value={search} onChangeText={setSearch}/></View>
        <Text style={styles.sectionTitle}>Popular Topics</Text>
        <View style={styles.topicsGrid}>{TOPICS.map((t,i)=>(<Pressable key={i} style={styles.topicChip}><Text style={styles.topicText}>{t}</Text></Pressable>))}</View>
        <Text style={styles.sectionTitle}>Contact Us</Text>
        <Pressable style={[styles.contactBtn,{backgroundColor:colors.secondary.DEFAULT}]}><Ionicons name="chatbubble-ellipses" size={20} color="#fff"/><Text style={styles.contactBtnText}>Chat with Support</Text></Pressable>
        <Pressable style={[styles.contactBtn,{backgroundColor:colors.secondary.emerald}]}><Ionicons name="call" size={20} color="#fff"/><Text style={styles.contactBtnText}>Call Support</Text></Pressable>
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
  searchWrap:{flexDirection:'row',alignItems:'center',backgroundColor:colors.neutral.surface,borderRadius:12,paddingHorizontal:14,paddingVertical:12,borderWidth:1,borderColor:colors.neutral.border},
  searchInput:{flex:1,fontSize:14,color:colors.neutral.text},
  sectionTitle:{fontSize:15,fontWeight:'700',color:colors.neutral.text},
  topicsGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  topicChip:{paddingHorizontal:14,paddingVertical:8,borderRadius:20,backgroundColor:colors.neutral.surface,borderWidth:1,borderColor:colors.neutral.border},
  topicText:{fontSize:13,fontWeight:'600',color:colors.neutral.text},
  contactBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,height:52,borderRadius:14},
  contactBtnText:{color:'#fff',fontSize:15,fontWeight:'700'},
});
